// Divine protection: playful replies when the protected contact is
// actually @mentioned in a group. Never triggers from plain text.
const config = require('../config');
const settings = require('./settings');
const { numberOf } = require('./utils/jid');

const REPLIES = [
  "Stop tagging him, he's busy 😂",
  'Why are you disturbing Divine? 😭',
  'Leave Divine alone for a minute.',
  "Divine is busy. He'll get back to you.",
  'You people should let this man breathe.',
  'Tagging him again won\'t make him reply faster.',
];

let last = -1;
const lastFire = new Map(); // groupId -> time

function pick() {
  let i;
  do { i = Math.floor(Math.random() * REPLIES.length); } while (REPLIES.length > 1 && i === last);
  last = i;
  return REPLIES[i];
}

const ready = () => config.protectedContact.ids.length > 0 && settings.isProtectOn();

// Returns a reply string, or null if nothing should be said.
function check({ isGroup, jid, senderNum, mentioned }) {
  if (!isGroup || !ready()) return null;
  const ids = config.protectedContact.ids;
  if (!(mentioned || []).some((j) => ids.includes(numberOf(j)))) return null;
  if (ids.includes(senderNum)) return null; // Divine tagging himself
  const now = Date.now();
  if (now - (lastFire.get(jid) || 0) < config.protectedContact.cooldownMs) return null;
  lastFire.set(jid, now);
  return pick();
}

module.exports = { check, REPLIES };
