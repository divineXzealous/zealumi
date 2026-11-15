const settings = require('./settings');
const memory = require('./memory');

module.exports = [
  {
    // ".chatbot on/off" (".ai on/off" works too)
    name: 'chatbot', aliases: ['ai'], category: 'AI SYSTEM', menu: ['chatbot on', 'chatbot off'],
    run: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      if (arg !== 'on' && arg !== 'off') return ctx.reply('Use chatbot on or chatbot off.');
      if (ctx.isGroup && !ctx.isOwner) return ctx.reply('Only the owner can switch that in groups.');
      settings.setAi(ctx.jid, arg === 'on');
      return ctx.reply(arg === 'on' ? 'Chatbot is on for this chat.' : "Chatbot is off here. Commands still work.");
    },
  },
  {
    name: 'clear', category: 'AI SYSTEM', menu: ['clear'],
    run: (ctx) => { memory.clear(ctx.senderNum); return ctx.reply("Done. I've forgotten our conversation."); },
  },
  {
    name: 'protect', category: 'AI SYSTEM', menu: ['protect on', 'protect off'], ownerOnly: true,
    run: (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      if (arg !== 'on' && arg !== 'off') return ctx.reply('Use protect on or protect off.');
      settings.setProtect(arg === 'on');
      return ctx.reply(`Protection is ${arg}.`);
    },
  },
];
