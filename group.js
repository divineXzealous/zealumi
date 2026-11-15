// Group tools: add, kick, promote, demote, link, revoke, mute, unmute, lock, unlock,
// setname, setdesc, admins, groupinfo.
// Admin commands: group admins (or the owner) only, and Lumi must be a group admin herself
// (WhatsApp's rule, not ours). `admins` and `groupinfo` work for everyone.
// (hidetag / tagall live in hidetag.js.)
const settings = require('./settings');
const { numberOf } = require('./jid');
const { groupInfo } = require('./groupTools');

async function guard(ctx) {
  if (!ctx.isGroup) { await ctx.reply('Groups only.'); return null; }
  const info = await groupInfo(ctx.sock, ctx.jid);
  if (!ctx.isOwner && !info.admins.has(ctx.senderNum)) { await ctx.reply('Admins only.'); return null; }
  if (!info.botIsAdmin) { await ctx.reply("Make me an admin first. I can't do that otherwise."); return null; }
  return info;
}

// Targets: @mentions, else the person whose message was replied to.
const getTargets = (ctx) => [...new Set(ctx.mentioned.length ? ctx.mentioned : (ctx.ctxInfo?.participant ? [ctx.ctxInfo.participant] : []))];

const ADD_STATUS = {
  200: 'added',
  403: 'their privacy settings block adding them',
  408: 'they left recently and cannot be re-added yet',
  409: 'already in the group',
};

// promote / demote share everything except the action and the wording.
async function updateMembers(ctx, action, done, usage) {
  const info = await guard(ctx);
  if (!info) return;
  const targets = getTargets(ctx);
  if (!targets.length) return ctx.reply(usage);
  if (action === 'demote') {
    const protectedIds = settings.protectedIds();
    const blocked = targets.some((j) => { const n = numberOf(j); return info.botNumbers.includes(n) || settings.isOwner(n) || protectedIds.includes(n); });
    if (blocked) return ctx.reply("Not him. Not me either. Pick someone else.");
  }
  const res = await ctx.sock.groupParticipantsUpdate(ctx.jid, targets, action);
  const failed = (res || []).filter((r) => String(r.status) !== '200');
  return ctx.reply(failed.length ? "Couldn't do it for everyone. WhatsApp said no." : done);
}

// Simple on/off style group setting.
const setting = (name, value, done, usage) => ({
  name, category: 'GROUP TOOLS', menu: [name],
  run: async (ctx) => {
    if (!(await guard(ctx))) return;
    await ctx.sock.groupSettingUpdate(ctx.jid, value);
    return ctx.reply(done);
  },
});

module.exports = [
  {
    name: 'add', category: 'GROUP TOOLS', menu: ['add <number>'],
    run: async (ctx) => {
      const info = await guard(ctx);
      if (!info) return;
      const nums = ctx.args.map((a) => a.replace(/\D/g, '')).filter((n) => n.length >= 7 && n.length <= 15);
      if (!nums.length) return ctx.reply(`Give me a number with country code.\nExample: ${settings.prefix()}add 2348012345678`);
      const res = await ctx.sock.groupParticipantsUpdate(ctx.jid, nums.map((n) => `${n}@s.whatsapp.net`), 'add');
      const lines = (res || []).map((r) => `${numberOf(r.jid)}: ${ADD_STATUS[r.status] || `failed (${r.status})`}`);
      return ctx.reply(lines.join('\n') || 'Nothing happened.');
    },
  },
  {
    name: 'kick', category: 'GROUP TOOLS', menu: ['kick @user'],
    run: async (ctx) => {
      const info = await guard(ctx);
      if (!info) return;
      const targets = getTargets(ctx);
      if (!targets.length) return ctx.reply(`Tag who to remove, or reply to their message.\nExample: ${settings.prefix()}kick @user`);
      const protectedIds = settings.protectedIds();
      const blocked = targets.filter((j) => {
        const n = numberOf(j);
        return info.botNumbers.includes(n) || settings.isOwner(n) || protectedIds.includes(n);
      });
      if (blocked.length) return ctx.reply("Not him. Not me either. Pick someone else.");
      const res = await ctx.sock.groupParticipantsUpdate(ctx.jid, targets, 'remove');
      const failed = (res || []).filter((r) => String(r.status) !== '200');
      return ctx.reply(failed.length ? "Couldn't remove everyone. Admins can't be removed by me." : 'Gone.');
    },
  },
  {
    name: 'promote', category: 'GROUP TOOLS', menu: ['promote @user'],
    run: (ctx) => updateMembers(ctx, 'promote', "Done. They're an admin now. Don't make me regret it.",
      `Tag who to promote, or reply to their message.\nExample: ${settings.prefix()}promote @user`),
  },
  {
    name: 'demote', category: 'GROUP TOOLS', menu: ['demote @user'],
    run: (ctx) => updateMembers(ctx, 'demote', 'Done. Back to normal member.',
      `Tag who to demote, or reply to their message.\nExample: ${settings.prefix()}demote @user`),
  },
  {
    name: 'link', category: 'GROUP TOOLS', menu: ['link'],
    run: async (ctx) => {
      if (!(await guard(ctx))) return;
      const code = await ctx.sock.groupInviteCode(ctx.jid);
      return ctx.reply(`Group link:\nhttps://chat.whatsapp.com/${code}`);
    },
  },
  {
    name: 'revoke', aliases: ['resetlink'], category: 'GROUP TOOLS', menu: ['revoke'],
    run: async (ctx) => {
      if (!(await guard(ctx))) return;
      await ctx.sock.groupRevokeInvite(ctx.jid);
      return ctx.reply(`Old link is dead. ${settings.prefix()}link for the new one.`);
    },
  },
  setting('mute', 'announcement', 'Group muted. Only admins can talk now. Peaceful.'),
  setting('unmute', 'not_announcement', 'Group unmuted. Everyone can talk again. Unfortunately.'),
  setting('lock', 'locked', 'Group info locked. Only admins can edit it.'),
  setting('unlock', 'unlocked', 'Group info unlocked. Everyone can edit it.'),
  {
    name: 'setname', category: 'GROUP TOOLS', menu: ['setname <name>'],
    run: async (ctx) => {
      if (!(await guard(ctx))) return;
      if (!ctx.argText) return ctx.reply(`Give me the new name.\nExample: ${settings.prefix()}setname Lumi Squad`);
      if (ctx.argText.length > 100) return ctx.reply('Group names are 100 characters max.');
      await ctx.sock.groupUpdateSubject(ctx.jid, ctx.argText);
      return ctx.reply('Name changed.');
    },
  },
  {
    name: 'setdesc', category: 'GROUP TOOLS', menu: ['setdesc <text>'],
    run: async (ctx) => {
      if (!(await guard(ctx))) return;
      if (!ctx.argText) return ctx.reply(`Give me the new description.\nExample: ${settings.prefix()}setdesc Be nice here`);
      await ctx.sock.groupUpdateDescription(ctx.jid, ctx.argText);
      return ctx.reply('Description changed.');
    },
  },
  {
    name: 'admins', category: 'GROUP TOOLS', menu: ['admins'],
    run: async (ctx) => {
      if (!ctx.isGroup) return ctx.reply('Groups only.');
      const meta = await ctx.sock.groupMetadata(ctx.jid);
      const admins = (meta.participants || []).filter((p) => p.admin === 'admin' || p.admin === 'superadmin');
      if (!admins.length) return ctx.reply('No admins. Anarchy.');
      const lines = admins.map((p) => `┃ ${p.admin === 'superadmin' ? '👑' : '🛡️'} @${numberOf(p.phoneNumber || p.id)}`).join('\n');
      return ctx.sock.sendMessage(ctx.jid, { text: `╭━━━「 ADMINS 」\n${lines}\n╰━━━━━━━━━━━━`, mentions: admins.map((p) => p.phoneNumber || p.id) }, { quoted: ctx.msg });
    },
  },
  {
    name: 'groupinfo', aliases: ['ginfo'], category: 'GROUP TOOLS', menu: ['groupinfo'],
    run: async (ctx) => {
      if (!ctx.isGroup) return ctx.reply('Groups only.');
      const m = await ctx.sock.groupMetadata(ctx.jid);
      const people = m.participants || [];
      const created = m.creation ? new Date(m.creation * 1000).toLocaleDateString() : 'Unknown';
      return ctx.reply(
        `╭━━━「 GROUP INFO 」\n` +
        `┃ Name: ${m.subject}\n` +
        `┃ Members: ${people.length}\n` +
        `┃ Admins: ${people.filter((p) => p.admin).length}\n` +
        `┃ Created: ${created}\n` +
        `┃ Description: ${m.desc || 'None'}\n` +
        `╰━━━━━━━━━━━━`);
    },
  },
];
