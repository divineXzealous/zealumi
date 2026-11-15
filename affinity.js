// .affinity [@user]      shows how Lumi feels about someone
// .resetaffinity @user   (owner) wipes it back to stranger. "all" = everyone (main owner only)
const extras = require('./extras');
const settings = require('./settings');
const { numberOf } = require('./jid');

// Who does this command point at? @mentions, else the replied-to person, plus any typed numbers.
function targetNumbers(ctx) {
  const out = new Set(ctx.mentioned.map(numberOf));
  ctx.args.map((a) => a.replace(/\D/g, '')).filter((x) => x.length >= 7 && x.length <= 15).forEach((x) => out.add(x));
  if (!out.size && ctx.ctxInfo && ctx.ctxInfo.participant) out.add(numberOf(ctx.ctxInfo.participant));
  return [...out].filter(Boolean);
}

module.exports = [
  {
    name: 'affinity', aliases: ['bond'], category: 'AI SYSTEM', menu: ['affinity [@user]'],
    run: async (ctx) => {
      const t = targetNumbers(ctx)[0];
      const num = t || ctx.senderNum;
      const a = extras.getAffinity(num);
      const who = t && t !== ctx.senderNum ? `@${num}` : 'You';
      const next = a.next ? `\n${a.next.need} more until "${a.next.level}".` : '\nThat is the top. Do not let it go to your head.';
      const mentions = ctx.mentioned.length ? ctx.mentioned : (ctx.ctxInfo && ctx.ctxInfo.participant ? [ctx.ctxInfo.participant] : []);
      return ctx.reply(`*Affinity*\n${who}: ${a.level} (${a.pts} pts)${next}`, who === 'You' ? {} : { mentions });
    },
  },
  {
    name: 'resetaffinity', aliases: ['affinityreset', 'affinityres'], category: 'OWNER', menu: ['resetaffinity @user', 'resetaffinity all'], ownerOnly: true,
    run: async (ctx) => {
      if ((ctx.args[0] || '').toLowerCase() === 'all') {
        if (!ctx.isMainOwner) return ctx.reply('Only the main owner can wipe everyone.');
        const c = extras.resetAllAffinity();
        return ctx.reply(`Done. ${c} ${c === 1 ? 'person is' : 'people are'} back to stranger.`);
      }
      const t = targetNumbers(ctx);
      if (!t.length) return ctx.reply(`Tag them, reply to their message, or type their number.\nExample: ${settings.prefix()}resetaffinity @user\nEveryone: ${settings.prefix()}resetaffinity all`);
      const c = extras.resetAffinity(t);
      return ctx.reply(c ? 'Done. Back to stranger.' : 'They had nothing to reset.');
    },
  },
];
