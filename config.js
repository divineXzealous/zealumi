// Central configuration. Everything comes from environment variables
// (Replit Secrets). Nothing secret is ever hard-coded.
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const digits = (v) => String(v || '').replace(/\D/g, '');
const ids = (v) => String(v || '').split(',').map(digits).filter(Boolean);
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

module.exports = {
  botName: 'Lumi',
  version: '1.0.0',
  prefix: process.env.PREFIX || '.',
  port: num(process.env.PORT, 3000),
  dataDir: process.env.DATA_DIR || 'data',
  authDir: process.env.AUTH_DIR || 'auth',
  databaseUrl: process.env.DATABASE_URL || '',
  pairingNumber: digits(process.env.PAIRING_NUMBER),

  owner: {
    name: process.env.OWNER_NAME || 'Divine',
    ids: ids(process.env.OWNER_NUMBER),
    showNumber: bool(process.env.OWNER_SHOW_NUMBER, false),
  },

  protectedContact: {
    ids: ids(process.env.PROTECTED_CONTACT_ID),
    enabled: bool(process.env.PROTECTED_ENABLED, true),
    cooldownMs: num(process.env.PROTECTED_COOLDOWN_MS, 30000),
  },

  ai: {
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 20000),
    userCooldownMs: num(process.env.AI_USER_COOLDOWN_MS, 1500),
    maxTokens: num(process.env.AI_MAX_TOKENS, 400),
    // Order matters: first = primary, then fallbacks.
    groq: { key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile' },
    deepseek: { key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' },
    gemini: { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' },
  },

  memory: { limit: num(process.env.MEMORY_LIMIT, 20) },
  sticker: { pack: process.env.STICKER_PACK || 'Lumi', author: process.env.STICKER_AUTHOR || 'Made by Lumi' },
  music: { country: process.env.MUSIC_COUNTRY || 'US' },
};
