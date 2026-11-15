// Per-user conversation memory, saved to disk. Users never share history.
const config = require('./config');
const { createStore } = require('./jsonStore');

const store = createStore('memory', {});

const get = (userId) => (store.data[userId] || []).slice();

function add(userId, role, content) {
  const list = store.data[userId] || (store.data[userId] = []);
  list.push({ role, content: String(content).slice(0, 2000) });
  while (list.length > config.memory.limit) list.shift();
  store.save();
}

function clear(userId) {
  delete store.data[userId];
  store.save();
}

const stats = () => ({ users: Object.keys(store.data).length });

module.exports = { get, add, clear, stats, init: () => store.load() };
