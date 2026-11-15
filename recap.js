// .recap [n]   short summary of the last n group messages (default 60, max 200).
// Only knows what Lumi saw since she last started (messages are kept in memory, not saved).
const chatlog = require('./chatlog');
const fallback = require('./fallback');
const settings = require('./settings');
const { offlineReply } = require('./personality');

const cooldown = new Map(); // chat -> time of last recap (30 s, saves AI calls)

const SYSTEM =
  'You summarise a WhatsApp group chat for someone who missed it. Sound like Lumi: dry, short, no fluff.\n' +
  'Format: one headline line saying what the chat was about, then at most 6 lines that each start with "• " ' +
  '(who said or decided what, plans, open questions). Plain text, no markdown, no intro, no outro. ' +
  'Only use what is in the chat; never invent details. Under 900 characters. Write in the language the chat uses.';

module.exports = [
  {
    name: 'recap', aliases: ['summary'], category: 'GROUP TOOLS', menu: ['recap [count]'],
    run: async (ctx) => {
      if (!ctx.isGroup) return ctx.reply('Groups only. A recap of one chat with you would be short.');
      const wanted = parseInt(ctx.args[0], 10);
      const n = Number.isFinite(wanted) ? Math.min(200, Math.max(10, wanted)) : 60;
      const lines = chatlog.last(ctx.jid, n);
      if (lines.length < 5) return ctx.reply("Not enough to recap. I only keep what I saw since I last started.");
      if (Date.now() - (cooldown.get(ctx.jid) || 0) < 30000) return ctx.reply('I just did one. Give it 30 seconds.');
      cooldown.set(ctx.jid, Date.now());

      let transcript = lines.map((l) => `${l.name}: ${l.text}`).join('\n');
      if (transcript.length > 6000) transcript = transcript.slice(-6000);

      await ctx.sock.sendPresenceUpdate('composing', ctx.jid).catch(() => {});
      const result = await fallback.generate([
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Chat (${lines.length} messages, oldest first):\n${transcript}` },
      ]);
      await ctx.sock.sendPresenceUpdate('paused', ctx.jid).catch(() => {});
      if (!result) return ctx.reply(offlineReply());
      return ctx.reply(`*Recap* (last ${lines.length} messages)\n${result.text.trim().slice(0, 1500)}`);
    },
  },
];
