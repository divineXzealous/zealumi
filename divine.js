// Divine protection: when the protected contact is actually @mentioned in a group,
// Lumi reacts and answers with a protective, rude-to-the-tagger line. Replies don't count.
const config = require('./config');
const settings = require('./settings');
const { numberOf } = require('./jid');

const NAME = config.owner.name;

// 20 different lines. The first five are the originals.
const REPLIES = [
  "Stop tagging him, he's busy 😂",
  `Why are you disturbing ${NAME}? 😭`,
  `Leave ${NAME} alone for a minute.`,
  `${NAME} is busy. He'll get back to you.`,
  'You people should let this man breathe.',
  "He saw the tag. He's ignoring you on purpose.",
  "Tagging him again won't make him reply faster. Obviously.",
  'Whatever it is, it is not that urgent. Sit down.',
  'Wow. Tagging him. Big move for someone with nothing to say.',
  "He has a life. You should try getting one.",
  'Does the tag button make you feel important? Put it down.',
  "One tag was already annoying. A second would be pathetic.",
  "Try handling it yourself for once. I believe in you. Barely.",
  "He'll answer when he feels like it, not when you do.",
  "Impressive. All that effort just to be annoying.",
  `${NAME} is not your personal help desk.`,
  "Is waiting ten minutes really that hard for you?",
  'Your patience is the size of a pea. Wait.',
  'That tag cost you whatever dignity you had left.',
  'Breathe. Wait. Stop touching the tag button.',
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
