// .tomp3  (reply to a video, voice note or audio) -> sends it back as an MP3.
const { findMedia, download } = require('./helpers');
const { toMp3 } = require('./ffmpeg');

const MAX_BYTES = 40 * 1024 * 1024;

module.exports = [
  {
    name: 'tomp3', aliases: ['mp3'], category: 'MEDIA', menu: ['tomp3'],
    run: async (ctx) => {
      const media = findMedia(ctx.msg, ['video', 'audio']);
      if (!media) return ctx.reply(`Reply to a video or a voice note with ${require('./settings').prefix()}tomp3`);
      if (Number(media.node.fileLength) > MAX_BYTES) return ctx.reply('That file is too big (40 MB max).');
      await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } }).catch(() => {});
      const buf = await download(ctx.sock, media.source);
      let mp3;
      try { mp3 = await toMp3(buf); } catch (_) { return ctx.reply("I can't convert audio on this server (ffmpeg is missing)."); }
      return ctx.sock.sendMessage(ctx.jid, { audio: mp3, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.msg });
    },
  },
];
