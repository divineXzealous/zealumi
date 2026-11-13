// Command registry. Add a command by adding it to one of the modules below
// (or a new module). The menu updates itself automatically.
const config = require('./config');
const settings = require('./settings');
const log = require('./logger');
const { findMedia } = require('./helpers');

const modules = [
  require('./general'), require('./ai'), require('./sticker'), require('./music'), require('./profile'),
  require('./group'), require('./afk'), require('./owner'),
];

const list = [];
const byName = new Map();
for (const mod of modules) {
  for (const cmd of mod) {
    list.push(cmd);
    byName.set(cmd.name, cmd);
    (cmd.aliases || []).forEach((a) => byName.set(a, cmd));
  }
}

// If the owner changes the prefix to something odd (an emoji, say) and forgets it, these
// few commands ALSO answer to the default prefix, so nobody gets locked out.
const RECOVERY = new Set(['setprefix', 'claim', 'wake']);

// ---- Commands WITHOUT the prefix: owners (and sub-owners) only ---------------------
// To avoid firing during normal chat, each command only counts when the message has the right shape:
//  'exact' = the message is just the command word ("menu", "ping"); 'rest' = word + free text ("afk lunch")
//  functions = needs a real target / number / media (so "kick @user" works, plain talk doesn't).
// In groups, 'exact' and 'rest' commands also need her name ("Lumi ping"), a tag, or a reply to her.
const hasNumber = (a) => a.some((x) => { const d = x.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15; });
const hasTarget = (ctx) => ctx.mentioned.length > 0 || Boolean(ctx.ctxInfo && ctx.ctxInfo.participant);
const hasMedia = (ctx, kinds) => Boolean(findMedia(ctx.msg, kinds));
const onOff = (a) => /^(?:on|off)$/i.test(a[0] || '');
const NO_PREFIX = {
  menu: 'exact', help: 'exact', ping: 'exact', about: 'exact', status: 'exact', owner: 'exact', clear: 'exact',
  afk: 'rest', play: 'rest',
  chatbot: (a) => onOff(a), protect: (a) => onOff(a),
  setprefix: (a) => a.length === 1 && (a[0].toLowerCase() === 'reset' || /^[^a-z0-9\s]{1,2}$/i.test(a[0])),
  add: (a) => hasNumber(a),
  kick: (a, ctx) => hasTarget(ctx),
  getpp: (a, ctx) => hasTarget(ctx),
  addsubowner: (a, ctx) => hasTarget(ctx) || hasNumber(a),
  delsubowner: (a, ctx) => hasTarget(ctx) || hasNumber(a),
  d: (a, ctx) => /^\d+\s*(?:s|sec|m|min|h|hr)?$/i.test(a[0] || '') && Boolean(ctx.ctxInfo && ctx.ctxInfo.stanzaId),
  s: (a, ctx) => hasMedia(ctx, ['image', 'video']),
  take: (a, ctx) => hasMedia(ctx, ['sticker']),
  toimg: (a, ctx) => hasMedia(ctx, ['sticker']),
  setprofilepic: (a, ctx) => hasMedia(ctx, ['image']),
};

function parseNoPrefix(text, ctx) {
  if (!ctx || !ctx.isOwner) return null;
  const stripped = text.replace(/^\s*(?:hey\s+)?lumi[\s,:;-]+/i, '');
  const startedWithName = stripped !== text;
  const [word, ...args] = stripped.trim().split(/\s+/);
  const cmd = byName.get((word || '').toLowerCase().replace(/[.,!?]+$/, ''));
  const rule = cmd && NO_PREFIX[cmd.name];
  if (!rule) return null;
  const addressed = !ctx.isGroup || startedWithName || Boolean(ctx.addressed);
  if (rule === 'exact') return args.length === 0 && addressed ? { cmd, args } : null;
  if (rule === 'rest') return (cmd.name !== 'play' || args.length > 0) && addressed ? { cmd, args } : null;
  return rule(args, ctx) ? { cmd, args } : null;
}

// Is this text a command? -> { cmd, args } or null
function parsePrefixed(text) {
  const custom = settings.prefix();
  let body;
  if (text.startsWith(custom)) body = text.slice(custom.length);
  else if (custom !== config.prefix && text.startsWith(config.prefix)) body = text.slice(config.prefix.length);
  else return null;
  const [name, ...args] = body.trim().split(/\s+/);
  const cmd = byName.get((name || '').toLowerCase());
  if (!cmd) return null;
  if (!text.startsWith(custom) && !RECOVERY.has(cmd.name)) return null;
  return { cmd, args };
}

function parse(text, ctx) {
  return parsePrefixed(text) || parseNoPrefix(text, ctx);
}

// Returns true if the message was a known command (and was handled).
async function run(ctx) {
  const parsed = parse(ctx.text, ctx);
  if (!parsed) return false;
  const { cmd, args } = parsed;
  ctx.args = args;
  ctx.argText = args.join(' ');
  ctx.commandList = list;
  try {
    if (cmd.mainOwnerOnly && !ctx.isMainOwner) { await ctx.reply('Only the main owner can do that.'); return true; }
    if (cmd.ownerOnly && !ctx.isOwner) { await ctx.reply('That one is for the owner only.'); return true; }
    await cmd.run(ctx);
  } catch (e) {
    log.error(`Command ${cmd.name} failed:`, e.message);
    await ctx.reply("That didn't work. Try again in a bit.").catch(() => {});
  }
  return true;
}

module.exports = { run, parse, list };
