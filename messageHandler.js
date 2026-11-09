// Decides what to do with each incoming message:
// 1) commands  2) Divine protection  3) AI chat (if Lumi is addressed)
const config = require('./config');
const log = require('./logger');
const { numberOf } = require('./jid');
const { isDuplicate } = require('./dedupe');
const { unwrap, getText, getContext } = require('./helpers');
const commands = require('./index');
const divine = require('./divine');
const settings = require('./settings');
const memory = require('./memory');
const fallback = require('./fallback');
const { systemPrompt, offlineReply } = require('./personality');

const lastAiAt = new Map();

function botNumbers(sock) {
  return [sock.user?.id, sock.user?.lid].filter(Boolean).map(numberOf);
}

// In groups Lumi only answers when addressed: her name, an @mention, or a reply to her.
function isAddressed(ctx, bots) {
  if (!ctx.isGroup) return true;
  if (/\blumi\b/i.test(ctx.text)) return true;
  if (ctx.mentioned.some((j) => bots.includes(numberOf(j)))) return true;
  if (ctx.ctxInfo?.participant && bots.includes(numberOf(ctx.ctxInfo.participant))) return true;
  return false;
}

async function handleMessage(sock, msg) {
  const receivedAt = Date.now();
  if (!msg.message || msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;
  if (isDuplicate(msg.key.id)) return;

  const ts = Number(msg.messageTimestamp) || 0;
  if (ts && Date.now() / 1000 - ts > 120) return; // ignore old backlog after reconnect

  const m = unwrap(msg.message);
  if (!m || m.protocolMessage || m.reactionMessage || m.senderKeyDistributionMessage && Object.keys(m).length === 1) return;

  const text = getText(m).trim();
  const isGroup = jid.endsWith('@g.us');
  const sender = msg.key.participant || jid;
  const senderNum = numberOf(sender);
  const ctxInfo = getContext(m);

  const ctx = {
    sock, msg, m, jid, sender, senderNum, text, isGroup, ctxInfo, receivedAt,
    pushName: msg.pushName || '',
    mentioned: ctxInfo?.mentionedJid || [],
    isOwner: config.owner.ids.includes(senderNum),
    reply: (t, extra = {}) => sock.sendMessage(jid, { text: t, ...extra }, { quoted: msg }),
  };

  // 1) Commands
  if (text.startsWith(config.prefix) && (await commands.run(ctx))) return;

  // 2) Divine protection
  const protect = divine.check(ctx);
  if (protect) { await ctx.reply(protect); return; }

  // 3) AI conversation
  if (!text || !settings.isAiOn(jid) || !isAddressed(ctx, botNumbers(sock))) return;
  const last = lastAiAt.get(senderNum) || 0;
  if (Date.now() - last < config.ai.userCooldownMs) return;
  lastAiAt.set(senderNum, Date.now());

  await sock.sendPresenceUpdate('composing', jid).catch(() => {});
  const messages = [
    { role: 'system', content: systemPrompt({ isGroup, name: ctx.pushName }) },
    ...memory.get(senderNum),
    { role: 'user', content: text },
  ];
  const result = await fallback.generate(messages);
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});

  if (!result) {
    log.warn('All AI providers failed for a message.');
    await ctx.reply(offlineReply());
    return;
  }
  memory.add(senderNum, 'user', text);
  memory.add(senderNum, 'assistant', result.text);
  await ctx.reply(result.text);
}

module.exports = { handleMessage };
