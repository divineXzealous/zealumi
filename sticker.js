// .s (image -> rounded sticker), .toimg and .take (sticker -> image)
// Works with just `sharp`. Video/animated stickers need two OPTIONAL extras
// (wa-sticker-formatter + ffmpeg-static) - see README. Without them Lumi says so.
require('./ffmpeg'); // sets FFMPEG_PATH if ffmpeg-static is installed
const sharp = require('sharp');
const config = require('./config');
const { findMedia, download } = require('./helpers');
const { gifToMp4 } = require('./ffmpeg');

let Fancy = null;
try { Fancy = require('wa-sticker-formatter'); } catch (_) { /* optional */ }

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 15 * 1024 * 1024;
const MAX_SECONDS = 10;
const MAX_STATIC_BYTES = 100 * 1024;
const MAX_ANIMATED_BYTES = 1024 * 1024;
const size = (node) => Number(node.fileLength) || 0;

// Rounded-square 512x512 WebP. "attention" crop keeps the subject centred.
async function liteSticker(buf) {
  const S = 512;
  const mask = Buffer.from(`<svg width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="96" ry="96" fill="#fff"/></svg>`);
  for (const quality of [85, 65, 45, 30]) {
    const out = await sharp(buf)
      .resize(S, S, { fit: 'cover', position: sharp.strategy.attention })
      .composite([{ input: mask, blend: 'dest-in' }])
      .webp({ quality })
      .toBuffer();
    if (out.length <= MAX_STATIC_BYTES) return out;
  }
  return null;
}

async function fancySticker(buf) {
  for (const quality of [70, 50, 30]) {
    const s = new Fancy.Sticker(buf, {
      pack: config.sticker.pack, author: config.sticker.author,
      type: Fancy.StickerTypes.ROUNDED, quality, background: 'transparent',
    });
    const out = await s.toBuffer();
    if (out.length <= MAX_ANIMATED_BYTES) return out;
  }
  return null;
}

async function makeSticker(ctx) {
  const media = findMedia(ctx.msg, ['image', 'video']);
  if (!media) return ctx.reply('Reply to an image with .s');

  if (media.kind === 'image' && size(media.node) > MAX_IMAGE) return ctx.reply('That image is too big (10 MB max).');
  if (media.kind === 'video') {
    if (!Fancy) return ctx.reply("Video stickers aren't enabled on this server. Images work.");
    if (size(media.node) > MAX_VIDEO) return ctx.reply('That video is too big (15 MB max).');
    if ((media.node.seconds || 0) > MAX_SECONDS) return ctx.reply(`Videos must be ${MAX_SECONDS} seconds or less.`);
  }

  const buf = await download(ctx.sock, media.source);
  const out = media.kind === 'video' || Fancy ? await fancySticker(buf) : await liteSticker(buf);
  if (!out) return ctx.reply("Couldn't squeeze that under WhatsApp's sticker size limit.");
  return ctx.sock.sendMessage(ctx.jid, { sticker: out }, { quoted: ctx.msg });
}

async function stickerToImage(ctx) {
  const media = findMedia(ctx.msg, ['sticker']);
  if (!media) return ctx.reply('Reply to a sticker first.');
  const buf = await download(ctx.sock, media.source);

  if (media.node.isAnimated) {
    try {
      const gif = await sharp(buf, { animated: true }).gif().toBuffer();
      const mp4 = await gifToMp4(gif); // throws if ffmpeg isn't installed
      return ctx.sock.sendMessage(ctx.jid, { video: mp4, gifPlayback: true }, { quoted: ctx.msg });
    } catch (_) {
      return ctx.reply("I can't convert animated stickers on this server. Static ones work.");
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
