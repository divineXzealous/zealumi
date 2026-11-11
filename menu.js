// Builds the menu automatically from the registered commands.
const settings = require('./settings');
const { label } = require('./personality');

const ORDER = ['GENERAL', 'AI SYSTEM', 'STICKER TOOLS', 'MEDIA', 'PROFILE', 'GROUP TOOLS', 'UTILITY', 'OWNER'];

function buildMenu(commands) {
  const prefix = settings.prefix();
  const groups = new Map();
  for (const c of commands) {
    if (c.hidden) continue;
    const cat = c.category || 'OTHER';
    if (!groups.has(cat)) groups.set(cat, []);
    for (const entry of c.menu || [c.name]) groups.get(cat).push(entry);
  }
  const cats = [...ORDER.filter((c) => groups.has(c)), ...[...groups.keys()].filter((c) => !ORDER.includes(c))];

  const lines = ['╭━━━「 L U M I 」', '┃', '┃ Status: Online', `┃ Personality: ${label()}`, '┃'];
  for (const cat of cats) {
    lines.push(`┣━━━「 ${cat} 」`);
    for (const e of groups.get(cat)) lines.push(`┃ ◈ ${prefix}${e}`);
    lines.push('┃');
  }
  lines.push('╰━━━━━━━━━━━━', '', 'Choose a command. I suppose.');
  return lines.join('\n');
}

module.exports = { buildMenu };
