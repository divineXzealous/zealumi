// .hidetag [text]   tags EVERYONE in the group without showing the @names.
// Reply to a message (text, image, video, audio, sticker) and it is re-sent with the hidden tags.
// Group admins and owners only. Lumi does not need to be admin for this one.
const { groupInfo } = require('./groupTools');
const { findMedia, download, getText, unwrap } = require('./helpers');

const MAX_BYTES = 30 * 1024 * 1024;

module.exports = [
  {
    name: 'hidetag', aliases: ['htag', 'tagall'], category: 'GROUP TOOLS', menu: ['hidetag [text]'],
    run: async (ctx) => {
      if (!ctx.isGroup) return ctx.reply('Groups only.');
      const info = await groupInfo(ctx.sock, ctx.jid);
      if (!ctx.isOwner && !info.admins.has(ctx.senderNum)) return ctx.reply('Admins only.');
      const mentions = [...new Set(info.meta.participants.map((p) => p.id).filter(Boolean))];

      const q = ctx.ctxInfo && ctx.ctxInfo.quotedMessage;
      const quotedText = q ? getText(unwrap(q)) : '';
      const text = ctx.argText || quotedText || '';

      const media = findMedia(ctx.msg, ['image', 'video', 'audio', 'sticker']);
      if (media) {
        if (Number(media.node.fileLength) > MAX_BYTES) return ctx.reply('That file is too big (30 MB max).');
        const buf = await download(ctx.sock, media.source);
        const content =
          media.kind === 'image' ? { image: buf, caption: text, mentions } :
          media.kind === 'video' ? { video: buf, caption: text, mentions } :
          media.kind === 'audio' ? { audio: buf, mimetype: media.node.mimetype || 'audio/mp4', ptt: Boolean(media.node.ptt), mentions } :
          { sticker: buf, mentions };
        return ctx.sock.sendMessage(ctx.jid, content);
      }
      return ctx.sock.sendMessage(ctx.jid, { text: text || '📢', mentions });
    },
  },
];
