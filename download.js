// .dl <link> [audio]   downloads a video / audio / image from a link and sends it.
//  - TikTok links: TikWM (free, no key)
//  - YouTube, Instagram, Twitter/X, Facebook, Reddit, SoundCloud ...: a cobalt server.
//    Set COBALT_API_URL (and COBALT_API_KEY if your server wants one) in .env.
//  - Direct file links (.mp4 .mp3 .jpg ...): downloaded as they are.
// Links that point at private/internal addresses are refused.
const dns = require('dns').promises;
const net = require('net');
const log = require('./logger');
const settings = require('./settings');
const { getText, unwrap } = require('./helpers');

const COBALT_URL = () => (process.env.COBALT_API_URL || '').trim();
const COBALT_KEY = () => (process.env.COBALT_API_KEY || '').trim();
const MAX_BYTES = () => (parseInt(process.env.DL_MAX_MB, 10) || 60) * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const EXT_KIND = { mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', '3gp': 'video', mp3: 'audio', m4a: 'audio', ogg: 'audio', opus: 'audio', wav: 'audio', aac: 'audio', flac: 'audio', jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image' };
const extOf = (u) => { try { return new URL(u).pathname.split('.').pop().toLowerCase(); } catch (_) { return ''; } };

// ---- safety: never fetch private / internal addresses --------------------------
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    return m ? isPrivateIp(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function assertPublic(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) links.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('private address');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('private address'); return; }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch (_) { return; } // can't resolve: let fetch fail on its own
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('private address');
}

// ---- small fetch helpers --------------------------------------------------------
async function getJson(url, { method = 'GET', headers = {}, body, timeoutMs = 25000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: { 'user-agent': UA, ...headers }, body, signal: ctrl.signal });
    let data = null;
    try { data = await res.json(); } catch (_) { /* not json */ }
    if (!res.ok && !(data && typeof data === 'object')) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    return data;
  } finally { clearTimeout(timer); }
}

async function readLimited(res, max) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new Error('too big');
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) { try { await reader.cancel(); } catch (_) {} throw new Error('too big'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error('too big');
  return buf;
}

// Downloads a file, following redirects by hand so each hop can be checked.
async function fetchFile(url) {
  let cur = url;
  for (let i = 0; i < 5; i++) {
    await assertPublic(cur);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(cur, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'manual', signal: ctrl.signal });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur).toString(); continue; }
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
      const buf = await readLimited(res, MAX_BYTES());
      return { buf, type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), url: cur };
    } finally { clearTimeout(timer); }
  }
  throw new Error('too many redirects');
}

// ---- sources ---------------------------------------------------------------------
const abs = (u, base) => new URL(u, base).toString();

async function viaTikwm(url, wantAudio) {
  const r = await getJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`);
  const d = r && r.data;
  if (!r || r.code !== 0 || !d) throw new Error((r && r.msg) || 'tikwm failed');
  const base = 'https://www.tikwm.com';
  if (wantAudio) { if (!d.music) throw new Error('no audio'); return [{ url: abs(d.music, base), hint: 'audio', title: d.title }]; }
  if (Array.isArray(d.images) && d.images.length) return d.images.slice(0, 8).map((u, i) => ({ url: abs(u, base), hint: 'image', title: i === 0 ? d.title : '' }));
  const v = d.hdplay || d.play;
  if (!v) throw new Error('no video');
  return [{ url: abs(v, base), hint: 'video', title: d.title }];
}

async function viaCobalt(url, wantAudio) {
  const base = COBALT_URL();
  if (!base) throw new Error('no cobalt');
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (COBALT_KEY()) headers.authorization = `Api-Key ${COBALT_KEY()}`;
  const r = await getJson(base.replace(/\/+$/, '') + '/', {
    method: 'POST', headers, timeoutMs: 45000,
    body: JSON.stringify({ url, downloadMode: wantAudio ? 'audio' : 'auto', videoQuality: '720', filenameStyle: 'basic' }),
  });
  if (!r) throw new Error('empty answer');
  if (r.status === 'error') throw new Error((r.error && r.error.code) || 'cobalt error');
  if ((r.status === 'tunnel' || r.status === 'redirect') && r.url) return [{ url: r.url, hint: wantAudio ? 'audio' : 'video', name: r.filename }];
  if (r.status === 'picker' && Array.isArray(r.picker)) return r.picker.slice(0, 8).map((p) => ({ url: p.url, hint: p.type === 'photo' ? 'image' : 'video' }));
  throw new Error('unexpected answer');
}

const isTikTok = (u) => /(^|\.)tiktok\.com$/i.test(new URL(u).hostname);

// Returns the list of files to download for this link.
async function resolveLink(url, wantAudio) {
  const tried = [];
  if (isTikTok(url)) {
    try { return await viaTikwm(url, wantAudio); } catch (e) { tried.push(`tikwm: ${e.message}`); }
  }
  if (COBALT_URL()) {
    try { return await viaCobalt(url, wantAudio); } catch (e) { tried.push(`cobalt: ${e.message}`); }
  }
  if (EXT_KIND[extOf(url)]) return [{ url, hint: EXT_KIND[extOf(url)] }]; // a plain file link
  const err = new Error(tried.join(' | ') || 'no downloader');
  err.noService = !COBALT_URL() && !isTikTok(url);
  throw err;
}

function kindOf(type, url, hint) {
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('image/')) return 'image';
  return EXT_KIND[extOf(url)] || hint || 'document';
}

async function sendFile(ctx, f, caption) {
  const file = await fetchFile(f.url);
  if (file.type === 'text/html') throw new Error('that link is a web page, not a file');
  const kind = kindOf(file.type, file.url, f.hint);
  const q = { quoted: ctx.msg };
  const cap = caption ? String(caption).slice(0, 300) : undefined;
  if (kind === 'video') return ctx.sock.sendMessage(ctx.jid, { video: file.buf, mimetype: 'video/mp4', caption: cap }, q);
  if (kind === 'audio') return ctx.sock.sendMessage(ctx.jid, { audio: file.buf, mimetype: file.type.startsWith('audio/') ? file.type : 'audio/mpeg', ptt: false }, q);
  if (kind === 'image') return ctx.sock.sendMessage(ctx.jid, { image: file.buf, caption: cap }, q);
  const name = f.name || decodeURIComponent(new URL(file.url).pathname.split('/').pop() || 'file');
  return ctx.sock.sendMessage(ctx.jid, { document: file.buf, mimetype: file.type || 'application/octet-stream', fileName: name }, q);
}

module.exports = [
  {
    name: 'dl', aliases: ['download'], category: 'DOWNLOAD', menu: ['dl <link>', 'dl <link> audio'],
    run: async (ctx) => {
      const quoted = ctx.ctxInfo && ctx.ctxInfo.quotedMessage ? getText(unwrap(ctx.ctxInfo.quotedMessage)) : '';
      const url = (/https?:\/\/[^\s<>"']+/i.exec(ctx.argText) || /https?:\/\/[^\s<>"']+/i.exec(quoted) || [])[0];
      if (!url) return ctx.reply(`Give me a link, or reply to one.\nExample: ${settings.prefix()}dl https://vm.tiktok.com/xxxx\nAdd "audio" to get just the sound.`);
      const wantAudio = /\b(?:audio|mp3)\b/i.test(ctx.argText.replace(url, ''));

      await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } }).catch(() => {});
      let files;
      try {
        files = await resolveLink(url, wantAudio);
      } catch (e) {
        log.warn(`dl could not resolve a link: ${e.message}`);
        if (e.noService) return ctx.reply("I can't download from that site yet. The server needs a downloader set up (COBALT_API_URL). TikTok and direct file links work without it.");
        return ctx.reply("Couldn't get that one. The link may be private, or the downloader is down.");
      }

      let sentAny = false;
      for (const f of files) {
        try { await sendFile(ctx, f, f.title); sentAny = true; } catch (e) {
          log.warn(`dl send failed: ${e.message}`);
          if (e.message === 'too big') return ctx.reply(`That file is over ${Math.round(MAX_BYTES() / 1048576)} MB. Too big to send.`);
          if (!sentAny && files.length === 1) return ctx.reply(/web page/.test(e.message) ? "That's a web page, not a file." : "Found it, but the download failed. Try again in a bit.");
        }
      }
      if (!sentAny) return ctx.reply("Found it, but none of the files would download.");
    },
  },
];
module.exports.isPrivateIp = isPrivateIp; // exported for tests
