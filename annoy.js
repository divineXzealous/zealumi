// Spots people who are being annoying to Lumi: the same message over and over, or a flood of messages.
// Only used for non-owners. After she snaps once, she ignores that person for a minute.
const REPEAT_WINDOW = 2 * 60 * 1000;
const REPEAT_LIMIT = 3;       // same text 3 times in 2 minutes
const FLOOD_WINDOW = 30 * 1000;
const FLOOD_LIMIT = 6;        // 6 messages to her in 30 seconds
const QUIET_FOR = 60 * 1000;

const history = new Map();    // number -> [{ t, text }]
const quietUntil = new Map(); // number -> time

const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Returns 'snap' (say a rude line now), 'quiet' (still annoyed, say nothing) or null (all fine).
function check(num, text, now = Date.now()) {
  if (!num) return null;
  if ((quietUntil.get(num) || 0) > now) return 'quiet';
  const list = (history.get(num) || []).filter((h) => now - h.t < REPEAT_WINDOW);
  const cur = norm(text);
  list.push({ t: now, text: cur });
  history.set(num, list);
  if (history.size > 2000) history.delete(history.keys().next().value);

  const same = list.filter((h) => h.text && h.text === cur).length;
  const flood = list.filter((h) => now - h.t < FLOOD_WINDOW).length;
  if ((cur.length >= 2 && same >= REPEAT_LIMIT) || flood >= FLOOD_LIMIT) {
    quietUntil.set(num, now + QUIET_FOR);
    history.delete(num);
    return 'snap';
  }
  return null;
}
const reset = () => { history.clear(); quietUntil.clear(); };

module.exports = { check, reset };
