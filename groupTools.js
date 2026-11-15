// Reads who the admins are in a group (works with phone numbers and hidden LIDs).
const { numberOf } = require('./jid');

async function groupInfo(sock, jid) {
  const meta = await sock.groupMetadata(jid);
  const nums = (p) => [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(numberOf);
  const admins = new Set(meta.participants.filter((p) => p.admin).flatMap(nums));
  const bots = [sock.user?.id, sock.user?.lid].filter(Boolean).map(numberOf);
  return { meta, admins, botNumbers: bots, botIsAdmin: bots.some((b) => admins.has(b)) };
}
module.exports = { groupInfo };
