// Small store with delayed writes. Saves to a private file (0600), or to the
// database when DATABASE_URL is set. Call load() once at start-up.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const log = require('./logger');

function createStore(name, initial) {
  const useDb = db.enabled();
  const file = path.join(config.dataDir, `${name}.json`);
  let data = initial;
  if (!useDb) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* first run */ }
  }

  let timer = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (useDb) {
      db.set(`store:${name}`, JSON.stringify(data)).catch((e) => log.error(`Could not save ${name}:`, e.message));
      return;
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  const save = () => { if (!timer) { timer = setTimeout(flush, 1500); timer.unref && timer.unref(); } };
  const load = async () => {
    if (!useDb) return;
    const v = await db.get(`store:${name}`);
    if (v) data = JSON.parse(v);
  };

  process.on('exit', () => { try { if (timer && !useDb) flush(); } catch (_) {} });
  process.on('SIGTERM', () => { if (timer) flush(); setTimeout(() => process.exit(0), 1500); });

  return { get data() { return data; }, save, flush, load };
}
module.exports = { createStore };
