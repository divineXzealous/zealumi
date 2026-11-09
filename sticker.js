// .s (image/video -> rounded sticker), .toimg and .take (sticker -> image)
require('./ffmpeg'); // must load first: sets FFMPEG_PATH for the sticker library
const sharp = require('sharp');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const config = require('./config');
const { findMedia, download } = require('./helpers');
const { gifToMp4 } = require('./ffmpeg');

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 15 * 1024 * 1024;
const MAX_SECONDS = 10;
const MAX_STICKER_BYTES = 1024 * 1024;

const size = (node) => Number(node.fileLength) || 0;

async function makeSticker(ctx) {
  const media = findMedia(ctx.msg, ['image', 'video']);
  if (!media) return ctx.reply('Reply to an image or short video with .s');

  if (media.kind === 'image' && size(media.node) > MAX_IMAGE) return ctx.reply('That image is too big (10 MB max).');
  if (media.kind === 'video') {
    if (size(media.node) > MAX_VIDEO) return ctx.reply('That video is too big (15 MB max).');
    if ((media.node.seconds || 0) > MAX_SECONDS) return ctx.reply(`Videos must be ${MAX_SECONDS} seconds or less.`);
  }

  const buf = await download(ctx.sock, media.source);
  let out = null;
  // WhatsApp caps sticker size, so lower the quality until it fits.
  for (const quality of [70, 50, 30]) {
    const sticker = new Sticker(buf, {
      pack: config.sticker.pack,
      author: config.sticker.author,
      type: StickerTypes.ROUNDED, // rounded square, subject kept centred
      quality,
      background: 'transparent',
    });
    out = await sticker.toBuffer();
    if (out.length <= MAX_STICKER_BYTES) break;
  }
  if (!out || out.length > MAX_STICKER_BYTES) return ctx.reply("Couldn't squeeze that under WhatsApp's sticker size limit.");
  return ctx.sock.sendMessage(ctx.jid, { sticker: out }, { quoted: ctx.msg });
}

async function stickerToImage(ctx) {
  const media = findMedia(ctx.msg, ['sticker']);
  if (!media) return ctx.reply('Reply to a sticker first.');
  const buf = await download(ctx.sock, media.source);

  if (media.node.isAnimated) {
    // Best effort: animated WebP -> GIF -> MP4 (WhatsApp plays it like a GIF).
    try {
      const gif = await sharp(buf, { animated: true }).gif().toBuffer();
      const mp4 = await gifToMp4(gif);
      return ctx.sock.sendMessage(ctx.jid, { video: mp4, gifPlayback: true }, { quoted: ctx.msg });
    } catch (_) {
      return ctx.reply("I couldn't convert that animated sticker.");
    }
  }
  const png = await sharp(buf).png().toBuffer();
  return ctx.sock.sendMessage(ctx.jid, { image: png }, { quoted: ctx.msg });
}

module.exports = [
  { name: 'take', category: 'STICKER TOOLS', menu: ['take'], run: stickerToImage },
  { name: 'toimg', category: 'STICKER TOOLS', menu: ['toimg'], run: stickerToImage },
  { name: 's', aliases: ['sticker'], category: 'STICKER TOOLS', menu: ['s'], run: makeSticker },
];
