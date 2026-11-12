// Command registry. Add a command by adding it to one of the modules below
// (or a new module). The menu updates itself automatically.
const config = require('./config');
const settings = require('./settings');
const log = require('./logger');

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

// Is this text a command? -> { cmd, args } or null
function parse(text) {
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

// Returns true if the message was a known command (and was handled).
async function run(ctx) {
  const parsed = parse(ctx.text);
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
