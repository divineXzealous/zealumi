const settings = require('./settings');

module.exports = [
  {
    name: 'afk', category: 'UTILITY', menu: ['afk [reason]'],
    run: (ctx) => {
      const reason = (ctx.argText || 'No reason given').slice(0, 120);
      settings.setAfk(ctx.senderNum, { reason, since: Date.now(), name: ctx.pushName || '' });
      return ctx.reply(`Fine. You're AFK: ${reason}\nI'll tell anyone who tags you. Send any message when you're back.`);
    },
  },
];
