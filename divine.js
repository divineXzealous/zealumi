// Divine protection: when the protected contact is actually @mentioned in a group,
// Lumi reacts and answers with a protective, rude-to-the-tagger line. Replies don't count.
const config = require('./config');
const settings = require('./settings');
const { numberOf } = require('./jid');

const NAME = config.owner.name;

const REPLIES = [
  'stop tagging my husband he is busy with me 🙃',
];
const REACTIONS = ['🙄', '😒', '🤨', '😐'];

let last = -1;
const lastFire = new Map(); // groupId -> time

function pick() {
  let i;
  do { i = Math.floor(Math.random() * REPLIES.length); } while (REPLIES.length > 1 && i === last);
  last = i;
  return REPLIES[i];
}
const emoji = () => REACTIONS[Math.floor(Math.random() * REACTIONS.length)];

// Returns { reply, emoji } or null if nothing should be said.
function check({ isGroup, jid, senderNum, mentioned }) {
  const ids = settings.protectedIds();
  if (!isGroup || !ids.length || !settings.isProtectOn()) return null;
  const targets = (mentioned || []).map(numberOf);
  if (!targets.some((n) => ids.includes(n))) return null;
  if (ids.includes(senderNum)) return null; // Divine tagging himself
  const now = Date.now();
  if (now - (lastFire.get(jid) || 0) < config.protectedContact.cooldownMs) return null;
  lastFire.set(jid, now);
  return { reply: pick(), emoji: emoji() };
}

module.exports = { check, REPLIES };
