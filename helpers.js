// Helpers for reading Baileys message objects.
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino')({ level: 'silent' });

// Peel off wrappers (disappearing messages, view-once, etc.)
function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner = m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage;
    if (!inner) break;
    m = inner.message;
  }
  return m;
}

function getText(m) {
  if (!m) return '';
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '';
}

// contextInfo holds mentions + the quoted (replied-to) message.
function getContext(m) {
  if (!m) return null;
  for (const v of Object.values(m)) if (v && typeof v === 'object' && v.contextInfo) return v.contextInfo;
  return null;
}

function pickMedia(m, kinds) {
  for (const k of kinds) if (m?.[`${k}Message`]) return { kind: k, node: m[`${k}Message`] };
  return null;
}

// Finds media in the message itself or in the message it replies to.
// kinds: any of 'image' | 'video' | 'sticker'
function findMedia(msg, kinds) {
  const m = unwrap(msg.message);
  const own = pickMedia(m, kinds);
  if (own) return { ...own, source: { key: msg.key, message: msg.message } };
  const ctx = getContext(m);
  if (ctx?.quotedMessage) {
    const q = unwrap(ctx.quotedMessage);
    const found = pickMedia(q, kinds);
    if (found) {
      return {
        ...found,
        source: { key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage },
      };
    }
  }
  return null;
}

const download = (sock, source) =>
  downloadMediaMessage(source, 'buffer', {}, { logger: pino, reuploadRequest: sock.updateMediaMessage });

module.exports = { unwrap, getText, getContext, findMedia, download };
