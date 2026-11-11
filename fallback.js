// Tries providers in order. One attempt per provider per message (no retry loops).
// A failing provider is put on "cooldown" so we stop wasting calls on it.
const providers = require('./providers');
const { stripReasoning } = require('./clean');
const log = require('./logger');

const cooldownUntil = new Map();

function cooldownFor(err) {
  const s = err && err.status;
  if (s === 429) {
    const ra = parseInt(err.retryAfter, 10);
    return (Number.isFinite(ra) ? Math.min(ra, 300) : 60) * 1000;
  }
  if (s === 401 || s === 403) return 10 * 60 * 1000; // bad key / no access
  if (s === 'leak') return 5 * 60 * 1000;            // model keeps writing its thinking
  if (s === 400 || s === 404) return 5 * 60 * 1000;  // invalid or unavailable model
  return 30 * 1000;                                   // timeout, 5xx, network
}

async function generate(messages) {
  for (const p of providers) {
    if (!p.enabled()) continue;
    if ((cooldownUntil.get(p.name) || 0) > Date.now()) continue;
    try {
      const raw = await p.call(messages);
      const { text, leaked } = stripReasoning(raw);
      if (leaked) log.warn(`${p.name} leaked its reasoning into the reply; cleaned it.`);
      if (!text) throw Object.assign(new Error('empty or unusable response'), { status: leaked ? 'leak' : 'empty' });
      return { text, provider: p.name };
    } catch (e) {
      const ms = cooldownFor(e);
      cooldownUntil.set(p.name, Date.now() + ms);
      log.warn(`${p.name} failed (${e.status || e.message}); skipping it for ${Math.round(ms / 1000)}s`);
    }
  }
  return null; // every provider failed or none configured
}

function status() {
  return providers.map((p) => {
    const cd = (cooldownUntil.get(p.name) || 0) - Date.now();
    return {
      name: p.name,
      configured: p.enabled(),
      cooling: cd > 0,
      cooldownSec: cd > 0 ? Math.ceil(cd / 1000) : 0,
    };
  });
}

const resetCooldowns = () => cooldownUntil.clear(); // used by tests

module.exports = { generate, status, resetCooldowns };
