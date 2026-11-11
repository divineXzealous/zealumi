// Entry point. Express keeps a web port open (Replit needs one) and
// starts the WhatsApp connection.
const express = require('express');
const config = require('./config');
const log = require('./logger');
const db = require('./db');
const memory = require('./memory');
const settings = require('./settings');
const { start, state } = require('./connection');
const { handleMessage } = require('./messageHandler');

const app = express();
app.get('/', (_req, res) => res.send('Lumi is up.'));
app.get('/health', (_req, res) => res.json({ status: state.status, uptimeSec: Math.floor(process.uptime()) }));

app.listen(config.port, () => log.info(`Web server on port ${config.port}`));

process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e && e.message ? e.message : e));
process.on('uncaughtException', (e) => log.error('Uncaught exception:', e && e.message ? e.message : e));

(async () => {
  await db.init();        // no-op unless DATABASE_URL is set
  await memory.init();
  await settings.init();
  await start(handleMessage);
})().catch((e) => log.error('Failed to start:', e.message));
