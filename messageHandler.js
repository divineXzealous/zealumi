// Decides what to do with each incoming message:
// learn ids -> AFK -> commands -> Divine protection -> AI chat (if Lumi is addressed)
const config = require('./config');
const log = require('./logger');
const { numberOf } = require('./jid');
const { fmtDuration } = require('./time');
const { isDuplicate } = require('./dedupe');
const { unwrap, getText, getContext } = require('./helpers');
const commands = require('./index');
const divine = require('./divine');
const settings = require('./settings');
const memory = require('./memory');
const fallback = require('./fallback');
const { systemPrompt, offlineReply, nameCallReply } = require('./personality');

const lastAiAt = new Map();
const afkNoticeAt = new Map();

const botNumbers = (sock) => [sock.user?.id, sock.user?.lid].filter(Boolean).map(numberOf);

// WhatsApp can show the same person as a phone number AND as a hidden id (LID).
// When we see both for a known owner/protected person, remember both.
function learnAliases(msg) {
  const k = msg.key;
  const ids = [k.participant, k.participantAlt, k.participantPn, k.remoteJidAlt, k.remoteJid]
    .filter((j) => j && (j.endsWith('@s.whatsapp.net') || j.endsWith('@lid')))
    .map(numberOf);
  const uniq = [...new Set(ids)];
  if (uniq.length < 2) return;
  if (uniq.some((n) => settings.isOwner(n))) settings.addClaimed(uniq);
  else if (uniq.some((n) => settings.protectedIds().includes(n))) settings.addProtectAlias(uniq);
}

// In groups Lumi only answers when addressed: her name, an @mention, or a reply to her.
function isAddressed(ctx, bots) {
  if (!ctx.isGroup) return true;
  if (/\blumi\b/i.test(ctx.text)) return true;
  if (ctx.mentioned.some((j) => bots.includes(numberOf(j)))) return true;
  if (ctx.ctxInfo?.participant && bots.includes(numberOf(ctx.ctxInfo.participant))) return true;
  return false;
}

async function afkHandling(ctx, isAfkCommand) {
  // 1) The AFK person is back
  const mine = settings.getAfk(ctx.senderNum);
  if (mine && !isAfkCommand) {
    settings.clearAfk(ctx.senderNum);
    await ctx.reply(`Back already? You were gone ${fmtDuration(Date.now() - mine.since)}.`);
  }
  // 2) Someone tagged / replied to an AFK person (groups only, max once per 5 min per person)
  if (!ctx.isGroup) return;
  const targets = [...new Set([...ctx.mentioned, ctx.ctxInfo?.participant].filter(Boolean).map(numberOf))];
  for (const n of targets) {
    const afk = settings.getAfk(n);
    if (!afk || n === ctx.senderNum) continue;
    const key = `${ctx.jid}:${n}`;
    if (Date.now() - (afkNoticeAt.get(key) || 0) < 5 * 60 * 1000) continue;
    afkNoticeAt.set(key, Date.now());
    await ctx.reply(`${afk.name || 'They'} is AFK: ${afk.reason} (${fmtDuration(Date.now() - afk.since)} ago).`);
  }
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
  if (!m || m.protocolMessage || m.reactionMessage || (m.senderKeyDistributionMessage && Object.keys(m).length === 1)) return;

  learnAliases(msg);

  const text = getText(m).trim();
  const isGroup = jid.endsWith('@g.us');
  const sender = msg.key.participant || jid;
  const senderNum = numberOf(sender);
  const ctxInfo = getContext(m);
  const prefix = settings.prefix();

  const ctx = {
    sock, msg, m, jid, sender, senderNum, text, isGroup, ctxInfo, receivedAt,
    pushName: msg.pushName || '',
    mentioned: ctxInfo?.mentionedJid || [],
    isOwner: settings.isOwner(senderNum),
    reply: (t, extra = {}) => sock.sendMessage(jid, { text: t, ...extra }, { quoted: msg }),
  };

  const isCmd = text.startsWith(prefix);
  const isAfkCommand = isCmd && /^afk(\s|$)/i.test(text.slice(prefix.length).trim());

  // 0) AFK bookkeeping (never blocks the rest)
  await afkHandling(ctx, isAfkCommand).catch((e) => log.warn('AFK handling failed:', e.message));

  // 1) Commands
  if (isCmd && (await commands.run(ctx))) return;

  // 2) Divine protection: react + reply
  const protect = divine.check(ctx);
  if (protect) {
    await sock.sendMessage(jid, { react: { text: protect.emoji, key: msg.key } }).catch(() => {});
    await ctx.reply(protect.reply);
    return;
  }

  // 3) AI conversation
  if (!text || !settings.isAiOn(jid) || !isAddressed(ctx, botNumbers(sock))) return;

  // Just her name ("Lumi") -> a quick answer with no AI call.
  if (/^@?\s*lumi[\s!?.,]*$/i.test(text)) { await ctx.reply(nameCallReply()); return; }

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
