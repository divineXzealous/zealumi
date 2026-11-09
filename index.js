// Command registry. Add a command by adding it to one of the modules below
// (or a new module). The menu updates itself automatically.
const config = require('./config');
const log = require('./logger');

const modules = [require('./general'), require('./ai'), require('./sticker'), require('./music'), require('./profile')];

const list = [];
const byName = new Map();
for (const mod of modules) {
  for (const cmd of mod) {
    list.push(cmd);
    byName.set(cmd.name, cmd);
    (cmd.aliases || []).forEach((a) => byName.set(a, cmd));
  }
}

// Returns true if the message was a known command (and was handled).
async function run(ctx) {
  const [name, ...args] = ctx.text.slice(config.prefix.length).trim().split(/\s+/);
  const cmd = byName.get((name || '').toLowerCase());
  if (!cmd) return false;
  ctx.args = args;
  ctx.argText = args.join(' ');
  ctx.commandList = list;
  try {
    if (cmd.ownerOnly && !ctx.isOwner) { await ctx.reply('That one is for the owner only.'); return true; }
    await cmd.run(ctx);
  } catch (e) {
    log.error(`Command ${cmd.name} failed:`, e.message);
    await ctx.reply("That didn't work. Try again in a bit.").catch(() => {});
  }
  return true;
}

module.exports = { run, list };
