// Divine protection: when the protected contact is @mentioned (or replied to)
// in a group, Lumi reacts and answers with a playful, protective line.
const config = require('./config');
const settings = require('./settings');
const { numberOf } = require('./jid');

const REPLIES = [
  "Stop tagging him, he's busy 😂",
  'Why are you disturbing Divine? 😭',
  'Leave Divine alone for a minute.',
  "Divine is busy. He'll get back to you.",
  'You people should let this man breathe.',
  "Tagging him again won't make him reply faster.",
  'He saw it. Relax.',
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
function check({ isGroup, jid, senderNum, mentioned, ctxInfo }) {
  const ids = settings.protectedIds();
  if (!isGroup || !ids.length || !settings.isProtectOn()) return null;
  const targets = [...(mentioned || []), ctxInfo && ctxInfo.participant].filter(Boolean).map(numberOf);
  if (!targets.some((n) => ids.includes(n))) return null;
  if (ids.includes(senderNum)) return null; // Divine tagging himself
  const now = Date.now();
  if (now - (lastFire.get(jid) || 0) < config.protectedContact.cooldownMs) return null;
  lastFire.set(jid, now);
  return { reply: pick(), emoji: emoji() };
}

module.exports = { check, REPLIES };
