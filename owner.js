// Owner tools: claim, unclaim, setprefix, setprofilepic
const crypto = require('crypto');
const config = require('./config');
const settings = require('./settings');
const { numberOf } = require('./jid');
const { findMedia, download } = require('./helpers');

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

module.exports = [
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
    name: 'unclaim', category: 'OWNER', hidden: true, ownerOnly: true,
    run: (ctx) => { settings.clearClaimed(); return ctx.reply('Cleared every claimed owner. Only the ids in my settings remain.'); },
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
