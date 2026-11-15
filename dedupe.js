// Prevents the same WhatsApp message id from being processed twice.
const seen = new Map();
const TTL = 10 * 60 * 1000;
function isDuplicate(id) {
  if (!id) return false;
  const now = Date.now();
  if (seen.has(id)) return true;
  seen.set(id, now);
  if (seen.size > 2000) for (const [k, t] of seen) if (now - t > TTL) seen.delete(k);
  return false;
}
module.exports = { isDuplicate };
