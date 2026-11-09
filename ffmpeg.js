// ffmpeg helper (used for animated sticker -> video). Sets FFMPEG_PATH
// so wa-sticker-formatter can find the same binary.
const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

let ffmpegPath = process.env.FFMPEG_PATH || null;
if (!ffmpegPath) { try { ffmpegPath = require('ffmpeg-static'); } catch (_) {} }
if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;

async function gifToMp4(buf) {
  if (!ffmpegPath) throw new Error('ffmpeg unavailable');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-'));
  const inp = path.join(dir, 'in.gif');
  const out = path.join(dir, 'out.mp4');
  try {
    await fs.writeFile(inp, buf);
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpegPath, ['-y', '-i', inp, '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', out]);
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exit ${c}`))));
    });
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
module.exports = { gifToMp4 };
