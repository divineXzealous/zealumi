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
  global.fetch = async (url) => {
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

  await test('menu is generated from registered commands and lists the new ones', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: '.menu' }));
    const t = last().text;
    for (const c of ['.chatbot on', '.setprefix', '.add', '.kick', '.afk', '.setprofilepic', '.play', '.getpp']) assert.ok(t.includes(c), c);
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
