// .play uses Apple's free iTunes Search API: real artist/track info,
// a legitimate store link, and Apple's licensed 30-second preview.
// It does NOT download or send full songs.
const config = require('./config');
const { request } = require('./http');

module.exports = [
  {
    name: 'play', category: 'MEDIA', menu: ['play'],
    run: async (ctx) => {
      const q = ctx.argText;
      if (!q) return ctx.reply('Tell me what to look for. Example: .play artist - song');

      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=1&country=${config.music.country}`;
      const data = await request(url, { timeoutMs: 15000 });
      const t = data?.results?.[0];
      if (!t) return ctx.reply("I couldn't find that one. Try 'artist - song'.");

      const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t.artistName} ${t.trackName}`)}`;
      const caption =
        `*${t.trackName}*\n${t.artistName}${t.collectionName ? `\nAlbum: ${t.collectionName}` : ''}\n\n` +
        `Listen: ${t.trackViewUrl}\nSearch on YouTube: ${yt}\n\n` +
        (t.previewUrl ? '(Sending a 30-second preview. Full song is at the links.)' : '(No preview available. Use the links.)');

      if (t.artworkUrl100) {
        try {
          const img = await request(t.artworkUrl100.replace('100x100', '600x600'), { as: 'buffer', timeoutMs: 15000 });
          await ctx.sock.sendMessage(ctx.jid, { image: img, caption }, { quoted: ctx.msg });
        } catch (_) { await ctx.reply(caption); }
      } else {
        await ctx.reply(caption);
      }

      if (t.previewUrl) {
        try {
          const audio = await request(t.previewUrl, { as: 'buffer', timeoutMs: 20000 });
          await ctx.sock.sendMessage(ctx.jid, { audio, mimetype: 'audio/mp4', ptt: false }, { quoted: ctx.msg });
        } catch (_) { await ctx.reply("The preview wouldn't load, but the links above work."); }
      }
    },
  },
];
