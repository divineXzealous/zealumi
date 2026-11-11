// WhatsApp connection (Baileys). Logs in with a PAIRING CODE so you can
// link it from the same phone (no QR scanning needed).
const fs = require('fs');
const path = require('path');
const baileys = require('@whiskeysockets/baileys');
const pino = require('pino');
const config = require('./config');
const log = require('./logger');
const db = require('./db');
const { usePgAuthState } = require('./pgAuthState');

const { default: makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

const state = { status: 'starting', startedAt: Date.now(), sock: null };
let retries = 0;
let pairingRequests = 0;           // codes asked for since this program started
const MAX_PAIRING_REQUESTS = 3;    // asking too often can make WhatsApp refuse for a while
const MAX_FAILED_CONNECTS = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const maskNumber = (n) => (n.length > 5 ? `${n.slice(0, 3)}${'*'.repeat(n.length - 5)}${n.slice(-2)}` : '***');

// A half-finished login attempt (never completed) can only cause trouble, so start clean.
function cleanUnfinishedAuth() {
  const file = path.join(config.authDir, 'creds.json');
  if (!fs.existsSync(file)) return;
  let registered = false;
  try { registered = JSON.parse(fs.readFileSync(file, 'utf8')).registered === true; } catch (_) { registered = false; }
  if (!registered) {
    fs.rmSync(config.authDir, { recursive: true, force: true });
    log.info('Removed an unfinished login attempt. Starting clean.');
  }
}

async function wipeAuth() {
  if (db.enabled()) await db.delPrefix('auth:').catch(() => {});
  else fs.rmSync(config.authDir, { recursive: true, force: true });
}

const EXPLAIN = {
  401: 'WhatsApp says this login is no longer valid (logged out / code rejected).',
  403: 'WhatsApp blocked this connection (403). The number or this server may be restricted.',
  405: 'WhatsApp refused the connection (405). Usually an outdated library/version or a blocked server address.',
  408: 'The connection timed out (408).',
  411: 'Multi-device mismatch (411).',
  428: 'The connection was closed by WhatsApp (428).',
  440: 'Another copy of Lumi is using this login (440).',
  500: 'Bad session data (500).',
  503: 'WhatsApp is temporarily unavailable (503).',
  515: 'WhatsApp asked for a restart (515). This is normal right after linking.',
};

async function requestCode(sock) {
  const n = config.pairingNumber;
  if (!n) {
    log.warn('Not linked yet and PAIRING_NUMBER is empty. Add it to .env (digits only, with country code) and restart.');
    return;
  }
  log.info(`Linking number ${maskNumber(n)} (${n.length} digits).`);
  if (n.length < 8 || n.length > 15 || n.startsWith('0')) {
    log.warn('PAIRING_NUMBER looks wrong. Use digits only, with the country code, no "+", no spaces and no leading 0.');
  }
  if (pairingRequests >= MAX_PAIRING_REQUESTS) {
    log.error(`Asked for ${MAX_PAIRING_REQUESTS} pairing codes already. Stopping so WhatsApp doesn't block you. Wait 30 minutes, then restart once.`);
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      pairingRequests += 1;
      const code = await sock.requestPairingCode(n);
      const pretty = String(code).replace(/(.{4})(.+)/, '$1-$2');
      console.log(`\n==============================\n PAIRING CODE:  ${pretty}\n==============================`);
      console.log('On the phone with that number: WhatsApp > Settings > Linked Devices > Link a Device >');
      console.log('"Link with phone number instead" > type the code. You have about a minute.\n');
      return;
    } catch (e) {
      pairingRequests -= 1; // a failed attempt does not count
      log.warn(`Pairing code attempt ${attempt}/3 failed: ${e.message}`);
      await sleep(config.connection.pairingRetryMs);
    }
  }
  log.error('Could not get a pairing code. Check the number, then restart. If it keeps failing, see the README section "Pairing problems".');
}

async function start(onMessage) {
  const useDb = db.enabled();
  if (!useDb) cleanUnfinishedAuth();
  const { state: auth, saveCreds } = useDb ? await usePgAuthState() : await useMultiFileAuthState(config.authDir);
  const silent = pino({ level: 'silent' });
  if (useDb) auth.keys = makeCacheableSignalKeyStore(auth.keys, silent);

  // Always use the newest WhatsApp Web version; an old one is a common cause of error 405.
  let version;
  try {
    const v = await fetchLatestBaileysVersion();
    version = v.version;
    if (v.error) log.warn("Couldn't fetch the latest WhatsApp version; using the built-in one.");
  } catch (e) { log.warn("Couldn't fetch the latest WhatsApp version:", e.message); }
  log.info(`Connecting to WhatsApp${version ? ` (web version ${version.join('.')})` : ''}...`);

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth,
    logger: silent,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  state.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  let pairingStarted = false;
  const startPairing = () => {
    if (pairingStarted || sock.authState.creds.registered) return;
    pairingStarted = true;
    requestCode(sock).catch((e) => log.error('Pairing failed:', e.message));
  };
  // The socket is ready for a code once WhatsApp sends its first "qr"; the timer is a backup.
  const backup = setTimeout(startPairing, 8000);
  if (backup.unref) backup.unref();

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) startPairing();

    if (connection) { state.status = connection; log.info(`WhatsApp connection: ${connection}`); }
    if (connection === 'open') {
      retries = 0;
      clearTimeout(backup);
      log.info('WhatsApp connected. Lumi is online.');
    }

    if (connection === 'close') {
      clearTimeout(backup);
      const code = lastDisconnect?.error?.output?.statusCode;
      const wasLinked = Boolean(sock.authState.creds.registered);
      log.warn(`Connection closed. Code ${code ?? 'unknown'}. ${EXPLAIN[code] || (lastDisconnect?.error?.message || '')}`);

      if (code === DisconnectReason.loggedOut && wasLinked) {
        state.status = 'logged-out';
        await wipeAuth();
        log.error('Logged out of WhatsApp. Cleared the saved login; getting a fresh pairing code...');
        setTimeout(() => start(onMessage).catch((e) => log.error('Restart failed:', e.message)), config.connection.reconnectBaseMs * 2.5);
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        state.status = 'replaced';
        log.error('Connection replaced: another Lumi instance is using this login. Stopping this one.');
        return;
      }
      if (++retries > MAX_FAILED_CONNECTS) {
        state.status = 'failed';
        log.error(`Failed ${MAX_FAILED_CONNECTS} times in a row. Stopping so WhatsApp doesn't block you. Fix the cause above, then restart.`);
        return;
      }
      const delay = Math.min(30000, config.connection.reconnectBaseMs * 2 ** Math.min(retries - 1, 4));
      log.info(`Reconnecting in ${Math.round(delay / 1000)}s... (try ${retries}/${MAX_FAILED_CONNECTS})`);
      setTimeout(() => start(onMessage).catch((e) => log.error('Reconnect failed:', e.message)), delay);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try { await onMessage(sock, msg); } catch (e) { log.error('Message handler error:', e.message); }
    }
  });
}

module.exports = { start, state };
