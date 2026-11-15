// View-once reveal (owner / sub-owner only)
//   .vv   reply to a view-once image / video / voice note: Lumi resends it as normal media, replying to your command
//   .vv2  same, but the revealed media goes to your DM instead of the chat
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const log = require('./logger');

const KINDS = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio' };

// Peels ephemeral + view-once wrappers (viewOnceMessage, V2, V2Extension) off the quoted message.
// WhatsApp sometimes strips the wrapper when quoting and only leaves viewOnce: true on the media, so check that too.
function findViewOnce(quoted) {
  let m = quoted;
  let wrapped = false;
  for (let i = 0; i < 5 && m; i++) {
    const vo = m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension;
    if (vo) { wrapped = true; m = vo.message; continue; }
    if (m.ephemeralMessage) { m = m.ephemeralMessage.message; continue; }
    break;
  }
  if (!m) return null;
  for (const key of Object.keys(KINDS)) {
    const node = m[key];
    if (node && (wrapped || node.viewOnce === true)) return { key, type: KINDS[key], node };
  }
  return null;
}

async function toBuffer(node, type) {
  const stream = await downloadContentFromMessage(node, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Plain (non view-once) message content, keeping the caption / voice-note flag.
function buildContent({ key, node }, buffer) {
  if (key === 'imageMessage') return { image: buffer, caption: node.caption || '' };
  if (key === 'videoMessage') return { video: buffer, caption: node.caption || '', mimetype: node.mimetype || 'video/mp4' };
  return { audio: buffer, mimetype: node.mimetype || 'audio/ogg; codecs=opus', ptt: node.ptt === true };
}

// Where .vv2 sends to: the private chat itself, or the sender's own number when used in a group.
function dmTarget(ctx) {
  if (!ctx.isGroup) return ctx.jid;
  const k = ctx.msg.key;
  return [k.participantPn, k.participantAlt, ctx.sender].find((j) => j && j.endsWith('@s.whatsapp.net')) || ctx.sender;
}

async function reveal(ctx, toDm) {
  try {
    const found = findViewOnce(ctx.ctxInfo && ctx.ctxInfo.quotedMessage);
    if (!found) return await ctx.reply('Reply to a view-once message');

    const buffer = await toBuffer(found.node, found.type);
    if (!buffer.length) throw new Error('empty download');
    const content = buildContent(found, buffer);

    if (toDm) {
      const dm = dmTarget(ctx);
      await ctx.sock.sendMessage(dm, content);
      if (dm !== ctx.jid) await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } }).catch(() => {});
    } else {
      await ctx.sock.sendMessage(ctx.jid, content, { quoted: ctx.msg });
    }
  } catch (e) {
    log.error('vv failed:', e.message);
    await ctx.reply("Couldn't reveal that one.").catch(() => {});
  }
}

module.exports = [
  { name: 'vv', category: 'OWNER', menu: ['vv'], ownerOnly: true, run: (ctx) => reveal(ctx, false) },
  { name: 'vv2', category: 'OWNER', menu: ['vv2'], ownerOnly: true, run: (ctx) => reveal(ctx, true) },
];
