// Optional Postgres storage (e.g. Neon free tier). Used when DATABASE_URL is set,
// so Lumi's WhatsApp login and memory survive restarts on hosts with no disk (Render free).
const config = require('../../config');
const log = require('./logger');

let pool = null;
const enabled = () => Boolean(config.databaseUrl);

function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10000, // drop idle connections so the free DB can sleep
    });
    pool.on('error', (e) => log.warn('DB connection dropped:', e.message));
  }
  return pool;
}

async function init() {
  if (!enabled()) return;
  await getPool().query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  log.info('Database storage ready.');
}

async function get(key) {
  const r = await getPool().query('SELECT value FROM kv WHERE key = $1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}
const set = (key, value) =>
  getPool().query('INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
const del = (key) => getPool().query('DELETE FROM kv WHERE key = $1', [key]);
const delPrefix = (prefix) => getPool().query('DELETE FROM kv WHERE key LIKE $1', [`${prefix}%`]);

module.exports = { enabled, init, get, set, del, delPrefix };
