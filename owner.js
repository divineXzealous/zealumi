// Owner tools: claim, unclaim, setprefix, setprofilepic
const crypto = require('crypto');
const config = require('./config');
const settings = require('./settings');
const { numberOf } = require('./jid');
const { findMedia, download } = require('./helpers');

const SLEEP_LINE = "Fine. I'm out. Wake me with 'lumi wake up' when you need me.";

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const attempts = new Map(); // number -> { n, first }

function tooManyAttempts(num) {
  const now = Date.now();
  const a = attempts.get(num);
  if (!a || now - a.first > 60 * 60 * 1000) { attempts.set(num, { n: 0, first: now }); return false; }
  return a.n >= 5;
}

// Every id WhatsApp gives us for this sender (phone number and/or hidden LID).
function senderIds(msg) {
  const k = msg.key;
  return [k.participant, k.participantAlt, k.participantPn, k.remoteJidAlt, k.remoteJid]
    .filter((j) => j && (j.endsWith('@s.whatsapp.net') || j.endsWith('@lid')))
    .map(numberOf);
}

// Who does this command point at? @mentions, else the replied-to person, plus any typed numbers.
function targetNumbers(ctx) {
  const out = new Set(ctx.mentioned.map(numberOf));
  const typed = ctx.args.map((a) => a.replace(/\D/g, '')).filter((x) => x.length >= 7 && x.length <= 15);
  typed.forEach((x) => out.add(x));
  if (!out.size && ctx.ctxInfo && ctx.ctxInfo.participant) out.add(numberOf(ctx.ctxInfo.participant));
  return [...out].filter(Boolean);
}

// "5s", "2m", "1h" (or just "5" = seconds). Between 1 second and 6 hours.
function parseDuration(a) {
  const m = /^(\d+)\s*(s|sec|m|min|h|hr)?$/i.exec(String(a || '').trim());
  if (!m) return null;
  const unit = (m[2] || 's').toLowerCase();
  const ms = parseInt(m[1], 10) * (unit.startsWith('h') ? 3600000 : unit.startsWith('m') ? 60000 : 1000);
  return ms >= 1000 && ms <= 6 * 3600000 ? ms : null;
}

module.exports = [
  {
    // .d 5s  (reply to a message): deletes that message after the time. Lumi's own messages always work;
    // other people's only work in groups where Lumi is an admin. Timers are lost if Lumi restarts.
    name: 'd', category: 'OWNER', menu: ['d <time>'], ownerOnly: true,
    run: async (ctx) => {
      const ms = parseDuration(ctx.args[0]);
      const q = ctx.ctxInfo;
      if (!ms || !q || !q.stanzaId) return ctx.reply(`Reply to a message and give a time.\nExample: ${settings.prefix()}d 5s  (1s to 6h)`);
      const mine = ctx.isLumiMessage(q.stanzaId, q.participant);
      const key = { remoteJid: ctx.jid, id: q.stanzaId, fromMe: mine, ...(mine || !q.participant ? {} : { participant: q.participant }) };
      await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏱️', key: ctx.msg.key } }).catch(() => {});
      const t = setTimeout(async () => {
        await ctx.sock.sendMessage(ctx.jid, { delete: key }).catch(() => {});
        await ctx.sock.sendMessage(ctx.jid, { delete: ctx.msg.key }).catch(() => {}); // the command itself (needs admin)
      }, ms);
      if (t.unref) t.unref();
    },
  },
  {
    // "lumi sleep" / "sleep lumi" work too (owner only)
    name: 'sleep', category: 'OWNER', menu: ['sleep'], ownerOnly: true,
    run: async (ctx) => { settings.setSleep(ctx.jid, true); await ctx.reply(SLEEP_LINE); },
  },
  {
    name: 'wake', category: 'OWNER', menu: ['wake'], ownerOnly: true,
    run: (ctx) => ctx.reply("I'm awake. Unfortunately."),
  },
  {
    // Hidden from the menu on purpose. Usage: .claim <passphrase>   (private chat only)
    name: 'claim', category: 'OWNER', hidden: true,
    run: async (ctx) => {
      if (!config.claimPassphrase) return ctx.reply('Claiming is switched off.');
      if (ctx.isGroup) return ctx.reply("Not here. Message me privately. And change that passphrase now; everyone just saw it.");
      if (tooManyAttempts(ctx.senderNum)) return ctx.reply('Too many tries. Come back later.');
      const given = ctx.argText;
      const ok = given && crypto.timingSafeEqual(sha(given), sha(config.claimPassphrase));
      if (!ok) { attempts.get(ctx.senderNum).n += 1; return ctx.reply("No."); }
      settings.addClaimed(senderIds(ctx.msg));
      return ctx.reply(`Okay. You're ${config.owner.name}. I'll remember.`);
    },
  },
  {
    name: 'unclaim', category: 'OWNER', hidden: true, mainOwnerOnly: true,
    run: (ctx) => { settings.clearClaimed(); return ctx.reply('Cleared every claimed owner. Only the ids in my settings remain.'); },
  },
  {
    name: 'addsubowner', category: 'OWNER', menu: ['addsubowner @user'], mainOwnerOnly: true,
    run: (ctx) => {
      const t = targetNumbers(ctx);
      if (!t.length) return ctx.reply(`Tag them, reply to their message, or type their number.\nExample: ${settings.prefix()}addsubowner @user`);
      if (t.every((n) => settings.isMainOwner(n))) return ctx.reply("That one's already the owner.");
      const added = settings.addSubOwners(t);
      return ctx.reply(added ? "Done. They can use owner commands now. Don't make me regret it." : 'They already have that.');
    },
  },
  {
    name: 'delsubowner', category: 'OWNER', menu: ['delsubowner @user'], mainOwnerOnly: true,
    run: (ctx) => {
      const t = targetNumbers(ctx);
      if (!t.length) return ctx.reply(`Tag them, reply to their message, or type their number.\nExample: ${settings.prefix()}delsubowner @user`);
      const removed = settings.removeSubOwners(t);
      return ctx.reply(removed ? 'Removed. Back to normal person.' : "They weren't a sub-owner.");
    },
  },
  {
    name: 'setprefix', category: 'OWNER', menu: ['setprefix <symbol>'], ownerOnly: true,
    run: (ctx) => {
      const cur = settings.prefix();
      const p = ctx.args[0];
      if (!p) return ctx.reply(`Current prefix: ${cur}\nUse: ${cur}setprefix ! (or "reset")`);
      if (p.toLowerCase() === 'reset') { settings.setPrefix(null); return ctx.reply(`Prefix reset to ${settings.prefix()}`); }
      if (p.length > 2 || /[a-z0-9\s]/i.test(p)) return ctx.reply('Use 1 or 2 symbols, like ! # $ or .');
      settings.setPrefix(p);
      return ctx.reply(`Prefix is now ${p}\nExample: ${p}menu`);
    },
  },
  {
    name: 'setprofilepic', category: 'OWNER', menu: ['setprofilepic'], ownerOnly: true,
    run: async (ctx) => {
      const media = findMedia(ctx.msg, ['image']);
      if (!media) return ctx.reply('Reply to an image with this command, or send an image with it as the caption.');
      if (Number(media.node.fileLength) > 10 * 1024 * 1024) return ctx.reply('That image is too big (10 MB max).');
      const { jidNormalizedUser } = require('@whiskeysockets/baileys');
      const buf = await download(ctx.sock, media.source);
      await ctx.sock.updateProfilePicture(jidNormalizedUser(ctx.sock.user.id), buf);
      return ctx.reply('Done. New face.');
    },
  },
];
