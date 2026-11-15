// Remembers the last messages of each group IN MEMORY ONLY (never saved to disk),
// so .recap has something to summarise. A restart empties it.
const MAX_PER_CHAT = 300;
const MAX_CHATS = 150;
const logs = new Map();

function add(jid, { name, text, ts }) {
  let l = logs.get(jid);
  if (!l) {
    if (logs.size >= MAX_CHATS) logs.delete(logs.keys().next().value);
    l = [];
    logs.set(jid, l);
  }
  l.push({ name: name || 'Someone', text: String(text).slice(0, 300), ts: ts || Date.now() });
  if (l.length > MAX_PER_CHAT) l.splice(0, l.length - MAX_PER_CHAT);
}

const last = (jid, n) => (logs.get(jid) || []).slice(-n);
const clear = (jid) => logs.delete(jid);

module.exports = { add, last, clear };
