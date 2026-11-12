// WhatsApp connection (Baileys). Logs in with a PAIRING CODE so you can
// link it from the same iPhone (no QR scanning needed).
const baileys = require('@whiskeysockets/baileys');
const pino = require('pino');
const config = require('./config');
const log = require('./logger');
const db = require('./db');
const { usePgAuthState } = require('./pgAuthState');

const { default: makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

const state = { status: 'starting', startedAt: Date.now(), sock: null };
let retries = 0;

// WhatsApp needs the number in full international format: digits only, country code first,
// no leading 0. A local-style number (e.g. 0803... in Nigeria) gives a code the phone rejects
// with "Couldn't link device", so fix the common mistakes here.
function normalizeNumber(raw) {
  let n = String(raw || '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);                          // 00234... -> 234...
  if (/^0[789]\d{9}$/.test(n)) n = '234' + n.slice(1);             // 0803xxxxxxx -> 234803xxxxxxx
  if (/^2340\d{10}$/.test(n)) n = '234' + n.slice(4);              // 2340803xxxxxxx -> 234803xxxxxxx
  return n;
}
const mask = (n) => `${n.slice(0, 3)}${'*'.repeat(Math.max(0, n.length - 7))}${n.slice(-4)}`;

async function start(onMessage) {
  const useDb = db.enabled();
  const { state: auth, saveCreds } = useDb ? await usePgAuthState() : await useMultiFileAuthState(config.authDir);
  const silent = pino({ level: 'silent' });
  if (useDb) auth.keys = makeCacheableSignalKeyStore(auth.keys, silent);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth,
    logger: silent,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  state.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  let pairingRequested = false;
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true;
      const number = normalizeNumber(config.pairingNumber);
      if (!number) {
        log.warn('Not linked yet. Add PAIRING_NUMBER (digits, with country code) to Secrets and restart.');
      } else if (number.length < 10 || number.length > 15) {
        log.error(`PAIRING_NUMBER looks wrong (${mask(number)}). Use digits only with the country code, e.g. 2348012345678.`);
      } else {
        try {
          log.info(`Requesting pairing code for ${mask(number)} (this must be the number of the WhatsApp account on the phone you link from)`);
          const code = await sock.requestPairingCode(number);
          const t = new Date().toISOString().slice(11, 19);
          console.log(`\n=== PAIRING CODE: ${String(code).replace(/(.{4})(.+)/, '$1-$2')} === (made at ${t} UTC, use it within about a minute)`);
          console.log('WhatsApp > Settings > Linked Devices > Link a Device > "Link with phone number instead"\n');
        } catch (e) {
          pairingRequested = false; // let the next QR event try again
          log.error('Could not get pairing code:', e.message);
        }
      }
    }

    if (connection) state.status = connection;
    if (connection === 'open') {
      retries = 0;
      log.info('WhatsApp connected.');
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        state.status = 'logged-out';
        if (useDb) await db.delPrefix('auth:').catch(() => {});
        log.error('Logged out of WhatsApp. Restart Lumi to get a new pairing code.');
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        // Another copy of Lumi is using this login (e.g. during a redeploy). Don't fight it.
        state.status = 'replaced';
        log.error('Connection replaced: another Lumi instance is running with this login. Stopping this one.');
        return;
      }
      const delay = Math.min(30000, 2000 * 2 ** Math.min(retries++, 4));
      log.warn(`Connection closed (code ${code}). Reconnecting in ${Math.round(delay / 1000)}s...`);
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
