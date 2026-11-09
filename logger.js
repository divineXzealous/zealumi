// Tiny logger that scrubs API keys from anything it prints.
const config = require('../../config');

function secrets() {
  const a = config.ai;
  return [a.groq.key, a.deepseek.key, a.gemini.key, config.databaseUrl].filter((k) => k && k.length > 6);
}
function scrub(v) {
  let s = typeof v === 'string' ? v : (v && v.message) || JSON.stringify(v);
  for (const k of secrets()) s = String(s).split(k).join('***');
  return s;
}
const stamp = () => new Date().toISOString().slice(11, 19);
const out = (lvl) => (...args) => console.log(`[${stamp()}] ${lvl}`, ...args.map(scrub));
module.exports = { info: out('INFO'), warn: out('WARN'), error: out('ERROR') };
