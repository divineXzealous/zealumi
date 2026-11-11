// Offline tests: no WhatsApp, no real API calls. Run with: npm test
// Heavy libraries (baileys, sharp, pino) are replaced by tiny stand-ins.
const Module = require('module');
const stubs = {
  '@whiskeysockets/baileys': { downloadMediaMessage: async () => Buffer.alloc(0), jidNormalizedUser: (j) => j, default: () => ({}), DisconnectReason: {} },
  pino: () => ({ level: 'silent' }),
  sharp: Object.assign(() => ({}), { strategy: { attention: 1 } }),
};
const origLoad = Module._load;
Module._load = function (request, ...rest) { return stubs[request] || origLoad.call(this, request, ...rest); };

process.env.DATA_DIR = require('os').tmpdir() + '/lumi-test-' + Date.now();
process.env.GROQ_API_KEY = 'groq-test-key-123';
process.env.DEEPSEEK_API_KEY = 'deepseek-test-key-123';
process.env.GEMINI_API_KEY = 'gemini-test-key-123';
process.env.PROTECTED_CONTACT_ID = '2348000000001';
process.env.CLAIM_PASSPHRASE = 'Ownerdivine00';
process.env.PROTECTED_COOLDOWN_MS = '0';
process.env.MEMORY_LIMIT = '4';

const assert = require('assert');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('  ok  ', name); };

// ---- helpers to fake WhatsApp
const sent = [];
const sock = {
  user: { id: '15550001111:3@s.whatsapp.net' },
  sendMessage: async (jid, content) => { sent.push({ jid, ...content }); return { key: { id: `out${sent.length}` } }; },
  sendPresenceUpdate: async () => {},
  groupMetadata: async () => ({ participants: [{ id: '2348111111111@s.whatsapp.net', admin: 'admin' }, { id: '15550001111@s.whatsapp.net', admin: 'admin' }] }),
  groupParticipantsUpdate: async (_j, targets) => targets.map((t) => ({ status: '200', jid: t })),
};
let n = 0;
const mk = ({ from, group, text, mentions = [], reply, name = 'Tester' }) => ({
  key: { remoteJid: group || `${from}@s.whatsapp.net`, id: `id${++n}`, participant: group ? `${from}@s.whatsapp.net` : undefined, fromMe: false },
  message: { extendedTextMessage: { text, contextInfo: { mentionedJid: mentions, ...(reply ? { participant: reply } : {}) } } },
  messageTimestamp: Math.floor(Date.now() / 1000), pushName: name,
});
const last = () => sent[sent.length - 1];
const texts = () => sent.map((s) => s.text).filter(Boolean);

(async () => {
  // --- fallback chain with a fake fetch
  const reply = (status, body) => ({ ok: status === 200, status, headers: { get: () => null }, json: async () => body });
  let plan = {};
  let lastBody = '';
  global.fetch = async (url, opts) => {
    lastBody = opts && opts.body;
    const p = url.includes('groq') ? 'groq' : url.includes('deepseek') ? 'deepseek' : 'gemini';
    const s = plan[p];
    if (s === 'hang') throw Object.assign(new Error('x'), { name: 'AbortError' });
    if (s !== 200) return reply(s);
    return reply(200, p === 'gemini'
      ? { candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] }
      : { choices: [{ message: { content: `from ${p}` } }] });
  };
  const fb = require('./fallback');
  const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }];

  await test('Groq answers first when healthy', async () => {
    plan = { groq: 200, deepseek: 200, gemini: 200 };
    assert.strictEqual((await fb.generate(msgs)).provider, 'Groq');
  });
  await test('429 on Groq falls back to DeepSeek, then Groq is skipped while cooling', async () => {
    plan = { groq: 429, deepseek: 200, gemini: 200 };
    assert.strictEqual((await fb.generate(msgs)).provider, 'DeepSeek');
    plan = { groq: 200, deepseek: 200, gemini: 200 };
    assert.strictEqual((await fb.generate(msgs)).provider, 'DeepSeek'); // Groq still cooling
  });
  await test('DeepSeek 500 falls to Gemini; all failing returns null', async () => {
    plan = { groq: 429, deepseek: 500, gemini: 200 };
    assert.strictEqual((await fb.generate(msgs)).provider, 'Gemini');
    plan = { groq: 500, deepseek: 500, gemini: 'hang' };
    assert.strictEqual(await fb.generate(msgs), null);
  });

  // --- memory
  const memory = require('./memory');
  await test('memory is per-user, limited and clearable', async () => {
    for (let i = 0; i < 6; i++) memory.add('a', 'user', 'm' + i);
    memory.add('b', 'user', 'other');
    assert.strictEqual(memory.get('a').length, 4);
    memory.clear('a');
    assert.strictEqual(memory.get('a').length, 0);
    assert.strictEqual(memory.get('b').length, 1);
  });

  // --- full message flow
  const { handleMessage } = require('./messageHandler');
  const settings = require('./settings');
  const G = '12345@g.us';
  const DIVINE = '2348000000001@s.whatsapp.net';

  await test('tagging Divine in a group: Lumi reacts AND replies', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349000000001', group: G, text: '@Divine come', mentions: [DIVINE] }));
    assert.ok(sent.some((s) => s.react), 'no reaction');
    assert.ok(sent.some((s) => s.text), 'no reply');
  });
  await test('Divine tagging himself, or plain text with his name, does nothing', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2348000000001', group: G, text: 'hi', mentions: [DIVINE] }));
    await handleMessage(sock, mk({ from: '2349000000001', group: G, text: 'where is divine' }));
    assert.strictEqual(sent.length, 0);
  });
  await test('replying to Divine\'s message does NOT trigger it (only real tags do)', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349000000002', group: G, text: 'hey', reply: DIVINE }));
    assert.strictEqual(sent.length, 0);
  });
  await test('.protect off stops it (owner only)', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349000000001', group: G, text: '.protect off' }));
    assert.ok(/owner only/i.test(last().text));
  });

  await test('.claim: wrong passphrase refused, group refused, right one in private works', async () => {
    const U = '2347000000007';
    sent.length = 0;
    await handleMessage(sock, mk({ from: U, text: '.claim wrong' }));
    assert.strictEqual(last().text, 'No.');
    assert.strictEqual(settings.isOwner(U), false);
    await handleMessage(sock, mk({ from: U, group: G, text: '.claim Ownerdivine00' }));
    assert.strictEqual(settings.isOwner(U), false);
    await handleMessage(sock, mk({ from: U, text: '.claim Ownerdivine00' }));
    assert.strictEqual(settings.isOwner(U), true);
    assert.ok(settings.protectedIds().includes(U));
  });
  await test('claim is rate-limited after 5 wrong tries', async () => {
    const V = '2347000000008';
    for (let i = 0; i < 6; i++) await handleMessage(sock, mk({ from: V, text: '.claim nope' }));
    await handleMessage(sock, mk({ from: V, text: '.claim Ownerdivine00' }));
    assert.strictEqual(settings.isOwner(V), false);
  });

  const OWNER = '2347000000007';
  await test('claimed owner now gets protected in groups, and can use owner commands', async () => {
    settings.setProtect(true);
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349000000001', group: G, text: 'yo', mentions: [`${OWNER}@s.whatsapp.net`] }));
    assert.ok(sent.some((s) => s.react));
  });

  await test('.setprefix changes the prefix; old prefix stops working', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: '.setprefix !' }));
    assert.strictEqual(settings.prefix(), '!');
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: '!ping' }));
    assert.ok(/Online/.test(last().text));
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: '.ping' }));
    assert.ok(!texts().some((t) => /Online/.test(t)));
    await handleMessage(sock, mk({ from: OWNER, text: '!setprefix reset' }));
    assert.strictEqual(settings.prefix(), '.');
  });

  await test('.afk: tagged AFK user gets announced, and returning clears it', async () => {
    const A = '2349100000001';
    await handleMessage(sock, mk({ from: A, group: G, text: '.afk lunch', name: 'Ayo' }));
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349100000002', group: G, text: 'hey', mentions: [`${A}@s.whatsapp.net`] }));
    assert.ok(/AFK: lunch/.test(last().text));
    sent.length = 0;
    await handleMessage(sock, mk({ from: A, group: G, text: 'im back' }));
    assert.ok(/Back already/.test(last().text));
    assert.strictEqual(settings.getAfk(A), null);
  });

  await test('.kick refuses the owner, works on others, needs admin', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349000000001', group: G, text: '.kick @x', mentions: ['2349555555555@s.whatsapp.net'] }));
    assert.strictEqual(last().text, 'Admins only.');
    // make the sender an admin via the fake group
    const admin = '2348111111111';
    sent.length = 0;
    await handleMessage(sock, mk({ from: admin, group: G, text: '.kick @owner', mentions: [`${OWNER}@s.whatsapp.net`] }));
    assert.ok(/Not him/.test(last().text));
    sent.length = 0;
    await handleMessage(sock, mk({ from: admin, group: G, text: '.kick @x', mentions: ['2349555555555@s.whatsapp.net'] }));
    assert.strictEqual(last().text, 'Gone.');
  });

  await test('saying just "Lumi" gets a quick answer; chatbot off silences chat', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349000000003', text: 'Lumi' }));
    assert.ok(['Yes?', 'Yeah?', 'What.', 'Hm?'].includes(last().text));
    await handleMessage(sock, mk({ from: OWNER, text: '.chatbot off' }));
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: 'Lumi' }));
    assert.strictEqual(sent.length, 0);
    await handleMessage(sock, mk({ from: OWNER, text: '.ai on' }));
  });

  await test('a reply to one of Lumi\'s messages gets an answer, even without her name', async () => {
    plan = { groq: 200, deepseek: 200, gemini: 200 };
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349000000009', group: G, text: 'Lumi' }));   // she says "Yes?" etc.
    const lumiMsgId = `out${sent.length}`;
    assert.ok(sent.length >= 1);
    const m = mk({ from: '2349000000009', group: G, text: 'How are you' });
    m.message.extendedTextMessage.contextInfo.stanzaId = lumiMsgId;
    m.message.extendedTextMessage.contextInfo.participant = '99887766554433@lid'; // her hidden id
    sent.length = 0;
    await handleMessage(sock, m);
    assert.ok(sent.some((x) => x.text), 'no answer to the reply');
    // and a reply to somebody else's message is still ignored
    const other = mk({ from: '2349000000009', group: G, text: 'How are you' });
    other.message.extendedTextMessage.contextInfo.stanzaId = 'someone-elses-message';
    other.message.extendedTextMessage.contextInfo.participant = '2349000000010@s.whatsapp.net';
    sent.length = 0;
    await handleMessage(sock, other);
    assert.strictEqual(sent.length, 0);
  });

  await test('Divine has 20 different lines, with no repeats back to back', async () => {
    const { REPLIES } = require('./divine');
    assert.strictEqual(REPLIES.length, 20);
    assert.strictEqual(new Set(REPLIES).size, 20);
    const seen = [];
    for (let i = 0; i < 40; i++) {
      sent.length = 0;
      await handleMessage(sock, mk({ from: '2349000000001', group: `g${i}@g.us`, text: 'x', mentions: [DIVINE] }));
      seen.push(sent.find((x) => x.text).text);
    }
    for (let i = 1; i < seen.length; i++) assert.notStrictEqual(seen[i], seen[i - 1]);
  });

  await test('.addsubowner / .delsubowner: only the main owner, and sub-owners get owner commands', async () => {
    const SUB = '2349200000001';
    // a stranger cannot
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349200000009', text: '.addsubowner ' + SUB }));
    assert.ok(/main owner|owner only/i.test(last().text));
    assert.strictEqual(settings.isOwner(SUB), false);
    // the main owner can (typed number, and by tag)
    await handleMessage(sock, mk({ from: OWNER, text: '.addsubowner ' + SUB }));
    assert.strictEqual(settings.isOwner(SUB), true);
    assert.strictEqual(settings.isMainOwner(SUB), false);
    // the sub-owner can use owner commands...
    sent.length = 0;
    await handleMessage(sock, mk({ from: SUB, text: '.protect on' }));
    assert.ok(/Protection is on/.test(last().text));
    // ...but cannot add more sub-owners or unclaim
    sent.length = 0;
    await handleMessage(sock, mk({ from: SUB, text: '.addsubowner 2349200000002' }));
    assert.ok(/main owner/i.test(last().text));
    assert.strictEqual(settings.isOwner('2349200000002'), false);
    // tag works too
    await handleMessage(sock, mk({ from: OWNER, group: G, text: '.addsubowner @x', mentions: ['2349200000003@s.whatsapp.net'] }));
    assert.strictEqual(settings.isOwner('2349200000003'), true);
    // remove
    await handleMessage(sock, mk({ from: OWNER, text: '.delsubowner ' + SUB }));
    assert.strictEqual(settings.isOwner(SUB), false);
  });

  await test('a sub-owner\'s hidden id is learned, and never turns into a main owner', async () => {
    const SUB2 = '2349200000003';
    const m = mk({ from: SUB2, group: G, text: 'hi' });
    m.key.participant = '55566677788@lid';
    m.key.participantAlt = SUB2 + '@s.whatsapp.net';
    await handleMessage(sock, m);
    assert.strictEqual(settings.isOwner('55566677788'), true);
    assert.strictEqual(settings.isMainOwner('55566677788'), false);
  });

  await test('assistant-style filler is stripped from AI replies', async () => {
    const { cleanReply } = require('./personality');
    assert.strictEqual(cleanReply('Fine. What do you need?'), 'Fine.');
    assert.strictEqual(cleanReply('Sure, whatever. Anything else?'), 'Whatever.');
    assert.strictEqual(cleanReply('I need something to eat, you?'), 'I need something to eat, you?');
  });

  await test('"who built you" is answered directly with the owner, never a company', async () => {
    plan = { groq: 500, deepseek: 500, gemini: 500 }; // if the AI were asked, we'd get the offline line
    const qs = ['who built you', 'Who made you?', 'who created u', 'who is your creator', 'what model are you', 'are you chatgpt', 'which company made you', 'Lumi who developed you'];
    for (const [i, q] of qs.entries()) {
      sent.length = 0;
      await handleMessage(sock, mk({ from: `23493100000${i}`, text: q }));
      assert.ok(/Divine/.test(last().text), q + ' -> ' + (last() && last().text));
      assert.ok(!/open\s*ai|chatgpt|google|meta/i.test(last().text));
    }
    plan = { groq: 200, deepseek: 200, gemini: 200 };
  });
  await test('normal questions are not mistaken for identity questions', async () => {
    const { identityReply } = require('./personality');
    for (const q of ['who made the pizza', 'build me a website', 'what is your favourite food', 'make me laugh']) assert.strictEqual(identityReply(q), null, q);
  });
  await test('an AI answer that names a company as her maker is rewritten', async () => {
    const { cleanReply } = require('./personality');
    const out = cleanReply('I was built by OpenAI. Whatever.');
    assert.ok(/Divine built me/.test(out) && !/OpenAI/.test(out), out);
  });
  await test('provocations are detected (and ordinary talk is not)', async () => {
    const { provocation } = require('./personality');
    assert.strictEqual(provocation('you are a retard lol'), 'insult');
    assert.strictEqual(provocation('good girl'), 'pet');
    assert.strictEqual(provocation("you're just a bot"), 'bot');
    assert.strictEqual(provocation('u r a robot'), 'bot');
    assert.strictEqual(provocation('stupid bot'), 'bot');
    assert.strictEqual(provocation('lumi bot how far'), 'bot');
    assert.strictEqual(provocation('hello how are you'), null);
    assert.strictEqual(provocation('this exam is stupid'), null);   // not aimed at her
    assert.strictEqual(provocation('what bot commands exist'), null);
  });
  await test('when provoked she ALWAYS hits back with an insult line, with no AI call', async () => {
    const { LINES } = require('./clapbacks');
    plan = { groq: 500, deepseek: 500, gemini: 500 }; // an AI call would give the offline line instead
    const cases = [['you stupid useless thing', 'insult'], ['you retard', 'insult'], ['good girl', 'pet'], ["you're just a bot", 'bot'], ['are you a robot lol', 'bot']];
    for (const [i, [msg, kind]] of cases.entries()) {
      sent.length = 0;
      await handleMessage(sock, mk({ from: `23493200000${i}`, text: msg }));
      assert.ok(LINES[kind].includes(last().text), `${msg} -> ${last() && last().text}`);
    }
    plan = { groq: 200, deepseek: 200, gemini: 200 };
  });
  await test('every comeback line is clean (no slurs, no false human/bot claims)', async () => {
    const { LINES } = require('./clapbacks');
    const all = Object.values(LINES).flat();
    assert.ok(all.length >= 60);
    for (const l of all) {
      assert.ok(!/retard|nigg|fag|slut|whore|cunt/i.test(l), l);
      assert.ok(!/\bnot a bot\b|i'?m (?:a )?human/i.test(l), l);
    }
  });
  await test('sincerely asked if she is human: she says no, honestly', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349330000001', text: 'are you human' }));
    assert.ok(/not (?:a )?(?:human|person)|no, i'?m not human|human\? no/i.test(last().text), last().text);
  });
  await test('her owner is teased through the AI (with a note), not insulted by canned lines', async () => {
    settings.addSubOwners(['2349400000001', '2349400000002']);
    require('./fallback').resetCooldowns();
    plan = { groq: 200, deepseek: 200, gemini: 200 };
    await handleMessage(sock, mk({ from: '2349400000001', text: 'you stupid useless bot' }));
    assert.ok(/RIGHT NOW/.test(lastBody) && /your person/.test(lastBody), 'no owner note sent to the AI');
  });
  await test('if the AI says "I am a bot/AI", the line is rewritten', async () => {
    const { cleanReply } = require('./personality');
    const out = cleanReply("I'm an AI. Whatever.");
    assert.ok(!/\bAI\b/.test(out) && /Lumi/.test(out), out);
  });

  await test('menu is generated from registered commands and lists the new ones', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: '.menu' }));
    const t = last().text;
    for (const c of ['.chatbot on', '.addsubowner', '.delsubowner', '.setprefix', '.add', '.kick', '.afk', '.setprofilepic', '.play', '.getpp']) assert.ok(t.includes(c), c);
    assert.ok(!t.includes('.claim'), 'claim must stay hidden');
    assert.ok(t.endsWith('Choose a command. I suppose.'));
  });

  await test('duplicate message ids are ignored', async () => {
    const m = mk({ from: OWNER, text: '.ping' });
    sent.length = 0;
    await handleMessage(sock, m); await handleMessage(sock, m);
    assert.strictEqual(sent.length, 1);
  });

  await test('logger scrubs API keys', async () => {
    let out = ''; const orig = console.log; console.log = (...a) => { out += a.join(' '); };
    require('./logger').error('failed with groq-test-key-123');
    console.log = orig;
    assert.ok(!out.includes('groq-test-key-123'));
  });

  console.log(`\n${passed} offline tests passed.`);
  process.exit(0);
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
