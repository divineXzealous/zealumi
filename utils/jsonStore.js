// Tiny JSON-file store: createStore(name, defaults) -> { data, load, save }
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function createStore(name, defaults = {}) {
  const file = path.join(DATA_DIR, `${name}.json`);
  const store = {
    data: JSON.parse(JSON.stringify(defaults)),

    load() {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        if (fs.existsSync(file)) {
          store.data = JSON.parse(fs.readFileSync(file, 'utf8'));
        }
      } catch (err) {
        console.error(`[jsonStore] load failed for ${name}:`, err.message);
      }
      return store.data;
    },

    save() {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(store.data));
        fs.renameSync(tmp, file);
      } catch (err) {
        console.error(`[jsonStore] save failed for ${name}:`, err.message);
      }
    },
  };
  return store;
}

module.exports = { createStore };
