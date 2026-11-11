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
const PAIRING_TIMEOUT_MS = 60 * 1000;

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
    connectTimeoutMs: 60000,
  });
  state.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  let pairingRequested = false;
  let pairTimer = null;
  let expired = false;
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true;
      if (!config.pairingNumber) {
        log.warn('Not linked yet. Add PAIRING_NUMBER (digits, with country code) to Secrets and restart.');
      } else {
        try {
          const code = await sock.requestPairingCode(config.pairingNumber);
          console.log(`\n=== PAIRING CODE: ${String(code).replace(/(.{4})(.+)/, '$1-$2')} ===`);
          // A pairing code only lives ~1 minute. If it is not used in time, drop this
          // connection and start a fresh one, which prints a brand-new code.
          pairTimer = setTimeout(() => {
            if (sock.authState.creds.registered) return;
            expired = true;
            log.warn('Pairing code expired after 1 minute. Getting a new one...');
            try { sock.end(new Error('pairing-timeout')); } catch {}
          }, PAIRING_TIMEOUT_MS);
          console.log('(This code is valid for 1 minute. A new one prints automatically after that.)');
          console.log('WhatsApp > Settings > Linked Devices > Link a Device > "Link with phone number instead"\n');
        } catch (e) {
          log.error('Could not get pairing code:', e.message);
        }
      }
    }

    if (connection) state.status = connection;
    if (connection === 'open') {
      clearTimeout(pairTimer);
      retries = 0;
      log.info('WhatsApp connected.');
    }
    if (connection === 'close') {
      clearTimeout(pairTimer);
      if (expired) {
        expired = false;
        retries = 0;
        setTimeout(() => start(onMessage).catch((e) => log.error('Restart failed:', e.message)), 2000);
        return;
      }
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        state.status = 'logged-out';
        if (useDb) await db.delPrefix('auth:').catch(() => {});
        else await require('fs').promises.rm(config.authDir, { recursive: true, force: true }).catch(() => {});
        log.error('Logged out / pairing rejected. Cleared the saved login; a fresh pairing code will be printed in 5s...');
        setTimeout(() => start(onMessage).catch((e) => log.error('Restart failed:', e.message)), 5000);
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
