// .getpp @user  (also works by replying to someone's message; in private chat, the other person)
const { request } = require('../utils/http');

module.exports = [
  {
    name: 'getpp', category: 'PROFILE', menu: ['getpp @user'],
    run: async (ctx) => {
      let target = ctx.mentioned[0] || (ctx.ctxInfo?.participant) || (!ctx.isGroup ? ctx.jid : null);
      if (!target) return ctx.reply('Tag someone: .getpp @user');
      let url;
      try {
        url = await ctx.sock.profilePictureUrl(target, 'image');
      } catch (_) {
        return ctx.reply("I can't get that picture. They may not have one, or they've hidden it.");
      }
      if (!url) return ctx.reply('No profile picture available.');
      const img = await request(url, { as: 'buffer', timeoutMs: 15000 });
      return ctx.sock.sendMessage(ctx.jid, { image: img }, { quoted: ctx.msg });
    },
  },
];
