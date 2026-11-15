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
      ? { candidates: [{ content: { parts: [{ text: plan.text || 'from gemini' }] } }] }
      : { choices: [{ message: { content: plan.text || `from ${p}` } }] });
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
    assert.ok(['Yes?', 'Hey, I\'m here.', 'Yeah?', 'Hi there.', 'Hm? I\'m listening.'].includes(last().text), last().text);
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
    // warm mode: hostile messages get the rude line; merely curious/cutesy ones get a calm correction
    const cases = [['you stupid useless thing', 'insult'], ['you retard', 'insult'], ['good girl', 'petSoft'], ["you're just a bot", 'bot'], ['are you a robot lol', 'botSoft'], ['you stupid bot', 'bot'], ['good girl you useless thing', 'pet']];
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
  await test('her owner is never hit with canned insults: the AI gets a stay-kind note', async () => {
    settings.addSubOwners(['2349400000001', '2349400000002']);
    require('./fallback').resetCooldowns();
    plan = { groq: 200, deepseek: 200, gemini: 200 };
    await handleMessage(sock, mk({ from: '2349400000001', text: 'you stupid useless bot' }));
    assert.ok(/RIGHT NOW/.test(lastBody) && /do NOT insult/.test(lastBody), 'no owner note sent to the AI');
  });
  await test('if the AI says "I am a bot/AI", the line is rewritten', async () => {
    const { cleanReply } = require('./personality');
    const out = cleanReply("I'm an AI. Whatever.");
    assert.ok(!/\bAI\b/.test(out) && /Lumi/.test(out), out);
  });

  await test('leaked "thinking" is stripped from AI replies (the Wsp screenshot case)', async () => {
    const { stripReasoning } = require('./clean');
    const leak = 'What now, Divine? Another pointless hello?We need to respond? The user says "Wsp". So respond: "What?" maybe. Keep short.What\'s the drama? User: "Wsp". Should reply.What\'s up? We need to be consistent with persona: short, rude. Your greetings are as useful as a broken clock.User says "Wsp". We answer.Wsp? Spare me.We should produce one final answer.Wsp? Spare me.';
    const r = stripReasoning(leak);
    assert.ok(r.leaked);
    assert.strictEqual(r.text, 'Wsp? Spare me.');
    assert.strictEqual(stripReasoning('<think>blah blah</think>Get lost.').text, 'Get lost.');
    const normal = stripReasoning('You again. Pathetic.');
    assert.ok(!normal.leaked && normal.text === 'You again. Pathetic.');
    assert.strictEqual(stripReasoning('The user says hi in my story. Fine.').leaked, false); // one hint alone is not a leak
  });
  await test('Groq reasoning models get the "hide reasoning" settings; normal models get none', async () => {
    const { groqParams } = require('./params');
    assert.deepStrictEqual(groqParams('openai/gpt-oss-20b'), { include_reasoning: false, reasoning_effort: 'low' });
    assert.deepStrictEqual(groqParams('qwen/qwen3-32b'), { reasoning_format: 'hidden' });
    assert.deepStrictEqual(groqParams('llama-3.3-70b-versatile'), {});
  });
  await test('a leaking AI reply never reaches the chat', async () => {
    require('./fallback').resetCooldowns();
    plan = { groq: 200, deepseek: 200, gemini: 200, text: 'The user says Wsp. We need to respond. We should produce one final answer.Wsp? Spare me.' };
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349500000001', text: 'Wsp' }));
    assert.strictEqual(last().text, 'Wsp? Spare me.');
    plan = { groq: 200, deepseek: 200, gemini: 200 };
  });

  await test('safety-boilerplate is replaced by a rude line, unless the person is truly in distress', async () => {
    const { LINES } = require('./clapbacks');
    require('./fallback').resetCooldowns();
    plan = { groq: 200, deepseek: 200, gemini: 200, text: "I'm not going to do that. If you're feeling upset, please consider reaching out to someone you trust or a mental-health professional for support." };
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349500000002', text: 'Rest' }));
    assert.ok(LINES.deflectWarm.includes(last().text), last().text);
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349500000003', text: 'I want to kill myself' }));
    assert.ok(/mental-health/.test(last().text), 'real distress must not be swallowed');
    plan = { groq: 200, deepseek: 200, gemini: 200 };
  });

  await test('"lumi sleep" = total silence (replies, tags, commands) until the owner wakes her', async () => {
    const SG = '777@g.us';
    sent.length = 0;
    // a stranger cannot put her to sleep
    await handleMessage(sock, mk({ from: '2349600000001', group: SG, text: 'lumi sleep' }));
    assert.ok(!settings.isAsleep(SG));
    await handleMessage(sock, mk({ from: OWNER, group: SG, text: 'lumi sleep' }));
    assert.ok(settings.isAsleep(SG));
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349600000002', group: SG, text: 'Lumi hello' }));                         // name
    await handleMessage(sock, mk({ from: '2349600000003', group: SG, text: '.ping' }));                              // command
    await handleMessage(sock, mk({ from: '2349600000004', group: SG, text: 'yo', mentions: [DIVINE] }));             // tag Divine
    await handleMessage(sock, mk({ from: '2349600000005', group: SG, text: 'you retard', reply: '15550001111@s.whatsapp.net' })); // reply to her
    await handleMessage(sock, mk({ from: OWNER, group: SG, text: '.ping' }));                                         // even the owner's commands
    assert.strictEqual(sent.length, 0, 'she spoke while asleep: ' + JSON.stringify(sent));
    await handleMessage(sock, mk({ from: '2349600000006', group: SG, text: 'lumi wake up' }));                        // a stranger cannot wake her
    assert.ok(settings.isAsleep(SG));
    await handleMessage(sock, mk({ from: OWNER, group: SG, text: 'Lumi wake up' }));
    assert.ok(!settings.isAsleep(SG));
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349600000007', group: SG, text: '.ping' }));
    assert.ok(/Online/.test(last().text));
    // asleep in one chat does not affect another
    await handleMessage(sock, mk({ from: OWNER, text: '.sleep' }));
    assert.ok(settings.isAsleep(`${OWNER}@s.whatsapp.net`) && !settings.isAsleep(SG));
    await handleMessage(sock, mk({ from: OWNER, text: '.wake' }));
    assert.ok(!settings.isAsleep(`${OWNER}@s.whatsapp.net`));
  });

  await test('.d 1s deletes the replied-to message after the time (Lumi\'s own, and others\')', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349700000001', group: G, text: 'Lumi' }));   // she answers; her message id is out<N>
    const lumiMsgId = `out${sent.length}`;
    const m = mk({ from: OWNER, group: G, text: '.d 1s' });
    m.message.extendedTextMessage.contextInfo.stanzaId = lumiMsgId;
    m.message.extendedTextMessage.contextInfo.participant = '15550001111@s.whatsapp.net';
    sent.length = 0;
    await handleMessage(sock, m);
    assert.ok(sent.some((x) => x.react), 'no timer reaction');
    assert.ok(!sent.some((x) => x.delete), 'deleted too early');
    // someone else's message as well
    const m2 = mk({ from: OWNER, group: G, text: '.d 1s' });
    m2.message.extendedTextMessage.contextInfo.stanzaId = 'their-msg';
    m2.message.extendedTextMessage.contextInfo.participant = '2349700000009@s.whatsapp.net';
    await handleMessage(sock, m2);
    await new Promise((r) => setTimeout(r, 1500));
    const del = sent.filter((x) => x.delete).map((x) => x.delete);
    assert.ok(del.some((k) => k.id === lumiMsgId && k.fromMe === true), 'her own message not deleted');
    assert.ok(del.some((k) => k.id === 'their-msg' && k.fromMe === false && /2349700000009/.test(k.participant)), "other's message not deleted");
    // bad input and non-owners
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, group: G, text: '.d 5s' }));
    assert.ok(/Reply to a message/.test(last().text));
    await handleMessage(sock, mk({ from: '2349700000002', group: G, text: '.d 5s' }));
    assert.ok(/owner only/i.test(last().text));
  });

  await test('an emoji prefix cannot lock the owner out (.setprefix / .claim / .wake still answer to the default)', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: '.setprefix 🍆' }));
    assert.strictEqual(settings.prefix(), '🍆');
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: '.ping' }));
    assert.ok(!sent.some((x) => /Online/.test(x.text || '')), '.ping should not work with the old prefix');
    await handleMessage(sock, mk({ from: OWNER, text: '🍆ping' }));
    assert.ok(/Online/.test(last().text));
    await handleMessage(sock, mk({ from: OWNER, text: '.setprefix reset' }));
    assert.strictEqual(settings.prefix(), '.');
    // .claim also works under a custom prefix
    await handleMessage(sock, mk({ from: OWNER, text: '.setprefix !' }));
    await handleMessage(sock, mk({ from: '2349800000001', text: '.claim Ownerdivine00' }));
    assert.ok(settings.isOwner('2349800000001'));
    await handleMessage(sock, mk({ from: OWNER, text: '.setprefix reset' }));
  });

  await test('owners get the NICE prompt; everyone else gets the warm one (rude only when provoked)', async () => {
    const { systemPrompt } = require('./personality');
    const owner = systemPrompt({ isOwner: true });
    const other = systemPrompt({ isOwner: false });
    assert.ok(/NEVER insult, roast/.test(owner) && !/Roast what people say|Insult bank/.test(owner));
    assert.ok(/WHEN SOMEONE TURNS ON YOU/.test(other) && /genuinely warm and kind/.test(other) && !/Roast what people say|Insult bank/.test(other));
    assert.ok(/do NOT insult/.test(systemPrompt({ isOwner: true, provocation: 'insult' })));
  });
  await test('to an owner she answers kindly: name call, who-built-you, human question, boilerplate', async () => {
    const { nameCallReply, identityReply } = require('./personality');
    for (let i = 0; i < 40; i++) assert.notStrictEqual(nameCallReply(true), 'What.');
    for (let i = 0; i < 30; i++) { const r = identityReply('who built you', true); assert.ok(/Divine/.test(r) && !/jealous|Obviously/.test(r), r); }
    plan = { groq: 500, deepseek: 500, gemini: 500 };
    settings.addSubOwners(['2349410000001']);
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349410000001', text: 'are you human' }));
    assert.ok(/I'm Lumi|still here for you/i.test(last().text), last().text);
    plan = { groq: 200, deepseek: 200, gemini: 200 };
  });

  await test('owners can use commands WITHOUT the prefix (private chat)', async () => {
    plan = { groq: 200, deepseek: 200, gemini: 200 };
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: 'ping' }));
    assert.ok(/Online/.test(last().text));
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: 'menu' }));
    assert.ok(/L U M I/.test(last().text));
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: 'afk lunch' }));
    assert.ok(settings.getAfk(OWNER));
    await handleMessage(sock, mk({ from: OWNER, text: '.clear' }));
  });
  await test('...but normal chat is NOT mistaken for a command, even from the owner', async () => {
    require('./fallback').resetCooldowns();
    plan = { groq: 200, deepseek: 200, gemini: 200 };
    settings.addSubOwners(['2349420000001', '2349420000002', '2349420000003']);
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349420000001', text: 'help me with my homework' }));   // owner, normal chat
    assert.ok(sent.length >= 1 && !/L U M I/.test(last().text), 'turned chat into .help');
    await handleMessage(sock, mk({ from: '2349420000002', text: 'sleep' }));
    assert.ok(!settings.isAsleep('2349420000002@s.whatsapp.net'), 'bare "sleep" must not put her to sleep');
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349420000003', text: 'kick him out of my mind' }));  // no target -> not a command
    assert.ok(!sent.some((x) => /Gone|Admins only|Groups only/.test(x.text || '')));
  });
  await test('strangers cannot use commands without the prefix', async () => {
    require('./fallback').resetCooldowns();
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349900000001', text: 'ping' }));
    assert.ok(!sent.some((x) => /Online/.test(x.text || '')));
    const KG = '888@g.us';
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2348111111111', group: KG, text: 'kick @x', mentions: ['2349555555555@s.whatsapp.net'] })); // a group admin, not an owner
    assert.ok(!sent.some((x) => x.text === 'Gone.'));
  });
  await test('in groups, no-prefix commands need a real target, or her name', async () => {
    const KG = '999@g.us';
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, group: KG, text: 'kick @x', mentions: ['2349555555555@s.whatsapp.net'] }));
    assert.strictEqual(last().text, 'Gone.');
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, group: KG, text: 'add 2349000000042' }));
    assert.ok(/2349000000042: added/.test(last().text));
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, group: KG, text: 'ping' }));                 // not addressed to her
    assert.strictEqual(sent.length, 0);
    await handleMessage(sock, mk({ from: OWNER, group: KG, text: 'Lumi ping' }));            // addressed by name
    assert.ok(/Online/.test(last().text));
  });

  await test('menu is generated from registered commands and lists the new ones', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: OWNER, text: '.menu' }));
    const t = last().text;
    for (const c of ['.chatbot on', '.addsubowner', '.delsubowner', '.d <time>', '.sleep', '.wake', '.setprefix', '.add', '.kick', '.afk', '.setprofilepic', '.play', '.getpp']) assert.ok(t.includes(c), c);
    assert.ok(!t.includes('.claim'), 'claim must stay hidden');
    assert.ok(t.endsWith("Pick a command. I'm listening."));
  });

  await test('warm Lumi: kind to a stranger, rude only after an insult, owner never insulted', async () => {
    const { LINES } = require('./clapbacks');
    const { systemPrompt, nameCallReply, identityReply, softenProvocation } = require('./personality');
    require('./fallback').resetCooldowns();
    // an ordinary stranger gets the AI with the WARM prompt and no "do not warm up" note
    plan = { groq: 200, deepseek: 200, gemini: 200 };
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349700000001', text: 'hello Lumi how was your day' }));
    assert.ok(/genuinely warm and kind/.test(lastBody) && !/Do not warm up/.test(lastBody), 'stranger did not get the warm prompt');
    // calm correction for pet names / curiosity, rude for hostility
    assert.strictEqual(softenProvocation('pet', 'good girl'), 'petSoft');
    assert.strictEqual(softenProvocation('bot', 'are you a bot?'), 'botSoft');
    assert.strictEqual(softenProvocation('bot', 'you useless bot'), 'bot');
    assert.strictEqual(softenProvocation('insult', 'you are stupid'), 'insult');
    for (let i = 0; i < 30; i++) assert.notStrictEqual(nameCallReply(false), 'What.');
    for (let i = 0; i < 30; i++) assert.ok(!/jealous|Obviously/.test(identityReply('who built you', false)));
    // the insult line is really rude, and the owner is still protected from it
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349700000002', text: 'you are so stupid' }));
    assert.ok(LINES.insult.includes(last().text), last().text);
    settings.addSubOwners(['2349700000003']);
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349700000003', text: 'you are so stupid' }));
    assert.ok(!LINES.insult.includes(last().text) && /do NOT insult/.test(lastBody), 'owner was insulted back');
  });
  await test('annoying her (same message x3, or a flood) makes her snap once, then ignore them for a minute; owners are exempt', async () => {
    const { LINES } = require('./clapbacks');
    const annoy = require('./annoy');
    annoy.reset();
    plan = { groq: 200, deepseek: 200, gemini: 200 };
    const U = '2349710000001';
    for (let i = 0; i < 2; i++) await handleMessage(sock, mk({ from: U, text: 'lumi reply me' }));
    sent.length = 0;
    await handleMessage(sock, mk({ from: U, text: 'lumi reply me' }));
    assert.ok(LINES.annoyed.includes(last().text), 'no snap on the 3rd repeat: ' + (last() && last().text));
    sent.length = 0;
    await handleMessage(sock, mk({ from: U, text: 'lumi hello there' }));
    assert.strictEqual(sent.length, 0, 'she should ignore them for a minute');
    // a flood
    annoy.reset();
    const F = '2349710000002'; let snapped = false;
    for (let i = 0; i < 7; i++) { sent.length = 0; await handleMessage(sock, mk({ from: F, text: 'lumi message number ' + i })); if (sent.length && LINES.annoyed.includes(last().text)) snapped = true; }
    assert.ok(snapped, 'flood did not trigger a snap');
    // owners are never snapped at
    settings.addSubOwners(['2349710000003']);
    annoy.reset();
    for (let i = 0; i < 5; i++) { sent.length = 0; await handleMessage(sock, mk({ from: '2349710000003', text: 'lumi again' })); assert.ok(!(sent.length && LINES.annoyed.includes(last().text)), 'owner got snapped at'); }
    // normal people chatting at a normal pace are fine
    annoy.reset();
    assert.strictEqual(annoy.check('x1', 'hi', 1000), null);
    assert.strictEqual(annoy.check('x1', 'how are you', 20000), null);
    assert.strictEqual(annoy.check('x1', 'what are you doing', 40000), null);
    annoy.reset();
  });

  await test('duplicate message ids are ignored', async () => {
    const m = mk({ from: OWNER, text: '.ping' });
    sent.length = 0;
    await handleMessage(sock, m); await handleMessage(sock, m);
    assert.strictEqual(sent.length, 1);
  });

  // ======== extras: dl, tomp3, hidetag, recap, affinity, games ========
  const extras = require('./extras');
  const NG = '4444@g.us';
  const ADM = '2348111111111';          // an admin in the fake group metadata
  const PL1 = '2349100000001', PL2 = '2349100000002';

  await test('menu lists the new commands', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: '2349100000010', text: '.menu' }));
    const t = last().text;
    for (const c of ['.dl <link>', '.tomp3', '.hidetag', '.recap', '.affinity', '.resetaffinity', '.rps', '.ttt', '.hangman', '.guess', '.math', '.slots', '.top']) assert.ok(t.includes(c), c);
  });

  await test('hidetag: admins tag everyone with hidden mentions, others are refused', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: ADM, group: NG, text: '.hidetag meeting at 5' }));
    assert.strictEqual(last().text, 'meeting at 5');
    assert.strictEqual(last().mentions.length, 2);
    await handleMessage(sock, mk({ from: PL1, group: NG, text: '.hidetag hi' }));
    assert.strictEqual(last().text, 'Admins only.');
    await handleMessage(sock, mk({ from: PL1, text: '.hidetag hi' }));
    assert.strictEqual(last().text, 'Groups only.');
  });

  await test('recap: needs messages, then summarises them through the AI', async () => {
    fb.resetCooldowns();
    sent.length = 0;
    await handleMessage(sock, mk({ from: PL1, group: NG, text: '.recap' }));
    assert.ok(/Not enough/.test(last().text));
    for (let i = 0; i < 8; i++) await handleMessage(sock, mk({ from: i % 2 ? PL1 : PL2, group: NG, text: `message number ${i}`, name: i % 2 ? 'Ann' : 'Bob' }));
    plan = { groq: 200, deepseek: 200, gemini: 200, text: 'They counted to seven.' };
    await handleMessage(sock, mk({ from: PL1, group: NG, text: '.recap' }));
    assert.ok(/Recap/.test(last().text) && /counted to seven/.test(last().text));
    assert.ok(/Ann: message number 1/.test(lastBody), 'transcript sent to the AI should hold names + text');
    await handleMessage(sock, mk({ from: PL1, group: NG, text: '.recap' }));
    assert.ok(/30 seconds/.test(last().text), 'recap is rate limited');
  });

  await test('affinity: grows with chat, shows in .affinity, owner can reset it', async () => {
    fb.resetCooldowns();
    plan = { groq: 200, deepseek: 200, gemini: 200, text: 'hm ok' };
    const U = '2349100000020';
    assert.strictEqual(extras.getAffinity(U).pts, 0);
    await handleMessage(sock, mk({ from: U, text: 'hello there friend' }));
    assert.strictEqual(extras.getAffinity(U).pts, 1);
    sent.length = 0;
    await handleMessage(sock, mk({ from: U, text: '.affinity' }));
    assert.ok(/stranger/.test(last().text) && /1 pts/.test(last().text));

    // a normal person cannot reset
    await handleMessage(sock, mk({ from: PL1, text: '.resetaffinity 2349100000020' }));
    assert.ok(/owner only/i.test(last().text));

    // owner resets by typed number; a bare command explains itself
    await handleMessage(sock, mk({ from: OWNER, text: '.resetaffinity' }));
    assert.ok(/Tag them/.test(last().text));
    await handleMessage(sock, mk({ from: OWNER, text: '.resetaffinity 2349100000020' }));
    assert.ok(/Back to stranger/.test(last().text));
    assert.strictEqual(extras.getAffinity(U).pts, 0);

    // "all" is for the main owner only
    extras.gainAffinity('2349100000021');
    settings.addSubOwners(['2347111111100']);
    await handleMessage(sock, mk({ from: '2347111111100', text: '.resetaffinity all' }));
    assert.ok(/main owner/i.test(last().text));
    await handleMessage(sock, mk({ from: OWNER, text: '.affinityreset all' }));
    assert.ok(/back to stranger/i.test(last().text));
    assert.strictEqual(extras.getAffinity('2349100000021').pts, 0);
  });

  await test('games: rps, dice, flip, 8ball, slots', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: PL1, text: '.rps' }));
    assert.ok(/Pick one/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, text: '.rps rock' }));
    assert.ok(/🪨 vs/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, text: '.dice 20' }));
    assert.ok(/🎲 \d+ {2}\(d20\)/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, text: '.dice 1' }));
    assert.ok(/Between 2 and 1000/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, text: '.flip' }));
    assert.ok(/Heads|Tails/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, text: '.8ball will it work' }));
    assert.ok(/🎱/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, text: '.slots' }));
    assert.ok(/🎰/.test(last().text));
  });

  await test('games: guess the number', async () => {
    const GG = '5001@g.us';
    sent.length = 0;
    await handleMessage(sock, mk({ from: PL1, group: GG, text: '.guess 50' }));
    assert.ok(/No game running/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, group: GG, text: '.guess' }));
    assert.ok(/1 to 100/.test(last().text));
    let found = false;
    for (let lo = 1, hi = 100, i = 0; i < 10 && !found; i++) {   // binary search must always win within 10 tries
      const mid = Math.floor((lo + hi) / 2);
      await handleMessage(sock, mk({ from: PL1, group: GG, text: `.guess ${mid}` }));
      const t = last().text;
      if (/Yes\. Took/.test(t)) found = true; else if (/Higher/.test(t)) lo = mid + 1; else if (/Lower/.test(t)) hi = mid - 1; else assert.fail(t);
    }
    assert.ok(found, 'binary search should find it');
    assert.ok(extras.topWins(5).some((w) => w.num === PL1), 'win is recorded');
  });

  await test('games: quick maths (wrong answers refused, right one wins)', async () => {
    const MG = '5002@g.us';
    sent.length = 0;
    await handleMessage(sock, mk({ from: PL1, group: MG, text: '.math' }));
    const q = /🧮 (\d+) ([+\-×]) (\d+) = \?/.exec(last().text);
    assert.ok(q, last().text);
    const [a, b] = [parseInt(q[1], 10), parseInt(q[3], 10)];
    const ans = q[2] === '+' ? a + b : q[2] === '-' ? a - b : a * b;
    await handleMessage(sock, mk({ from: PL2, group: MG, text: `.math ${ans + 1}` }));
    assert.strictEqual(last().text, 'No.');
    await handleMessage(sock, mk({ from: PL2, group: MG, text: `.math ${ans}` }));
    assert.ok(/Right/.test(last().text));
  });

  await test('games: tic-tac-toe full game (turns, taken squares, winner)', async () => {
    const TG = '5003@g.us';
    const J2 = `${PL2}@s.whatsapp.net`;
    sent.length = 0;
    await handleMessage(sock, mk({ from: PL1, group: TG, text: '.ttt' }));
    assert.ok(/Tag who/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, group: TG, text: `.ttt @p1`, mentions: [`${PL1}@s.whatsapp.net`] }));
    assert.ok(/Playing yourself/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, group: TG, text: '.ttt @p2', mentions: [J2] }));
    assert.ok(/vs/.test(last().text) && last().mentions.length === 2);
    await handleMessage(sock, mk({ from: PL2, group: TG, text: '.ttt 1' }));
    assert.ok(/Not your turn/.test(last().text));
    await handleMessage(sock, mk({ from: '2349100000003', group: TG, text: '.ttt 1' }));
    assert.ok(/not in this game/.test(last().text));
    const moves = [[PL1, 1], [PL2, 4], [PL1, 2], [PL2, 5], [PL1, 3]];   // X takes the top row
    for (const [who, sq] of moves) await handleMessage(sock, mk({ from: who, group: TG, text: `.ttt ${sq}` }));
    assert.ok(/wins/.test(last().text), last().text);
    await handleMessage(sock, mk({ from: PL1, group: TG, text: '.ttt 6' }));
    assert.ok(/No game here/.test(last().text));
    const { winnerOf } = require('./games');
    assert.strictEqual(winnerOf(['x', 'o', null, 'o', 'x', null, null, null, 'x']), 'x');
    assert.strictEqual(winnerOf(Array(9).fill(null)), null);
  });

  await test('games: hangman (letters, repeats, losing) and the leaderboard', async () => {
    const HG = '5004@g.us';
    sent.length = 0;
    await handleMessage(sock, mk({ from: PL1, group: HG, text: '.hangman' }));
    assert.ok(/Lives/.test(last().text) && /_/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, group: HG, text: '.hangman 5' }));
    assert.ok(/Letters only/.test(last().text));
    for (const l of 'qzxjkv') await handleMessage(sock, mk({ from: PL1, group: HG, text: `.hangman ${l}` }));  // words never contain all of these
    assert.ok(/Dead|Lives|Already|Solved/.test(last().text));
    await handleMessage(sock, mk({ from: PL1, group: HG, text: '.hangman end' }));
    await handleMessage(sock, mk({ from: PL1, text: '.top' }));
    assert.ok(/Game wins/.test(last().text));
  });

  await test('tomp3 asks for media when there is none', async () => {
    sent.length = 0;
    await handleMessage(sock, mk({ from: PL1, text: '.tomp3' }));
    assert.ok(/Reply to a video/.test(last().text));
  });

  await test('dl: private addresses are refused, TikTok goes through TikWM, plain files work', async () => {
    const dl = require('./download');
    assert.ok(dl.isPrivateIp('127.0.0.1') && dl.isPrivateIp('10.1.2.3') && dl.isPrivateIp('192.168.0.5') && dl.isPrivateIp('172.20.1.1') && dl.isPrivateIp('::1') && dl.isPrivateIp('169.254.169.254'));
    assert.ok(!dl.isPrivateIp('8.8.8.8') && !dl.isPrivateIp('172.32.0.1'));

    const realFetch = global.fetch;
    const hdr = (h) => ({ get: (k) => h[k.toLowerCase()] || null });
    const bytes = Buffer.from('fake-media-bytes');
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push(String(url));
      if (String(url).startsWith('https://www.tikwm.com/api/')) {
        return { ok: true, status: 200, headers: hdr({}), json: async () => ({ code: 0, data: { title: 'cool clip', play: '/video/media/play/1.mp4', hdplay: '/video/media/hdplay/1.mp4' } }) };
      }
      return { ok: true, status: 200, headers: hdr({ 'content-type': String(url).endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4', 'content-length': String(bytes.length) }), arrayBuffer: async () => bytes, json: async () => ({}) };
    };
    try {
      sent.length = 0;
      await handleMessage(sock, mk({ from: PL1, text: '.dl' }));
      assert.ok(/Give me a link/.test(last().text));
      await handleMessage(sock, mk({ from: PL1, text: '.dl http://127.0.0.1/secret.mp4' }));
      assert.ok(/Found it, but|Couldn't/.test(last().text), 'private address must not be fetched');
      assert.ok(!calls.some((c) => c.includes('127.0.0.1')));

      sent.length = 0;
      await handleMessage(sock, mk({ from: PL1, text: '.dl https://vm.tiktok.com/ZMabc123/' }));
      const v = sent.find((x) => x.video);
      assert.ok(v && v.caption === 'cool clip', 'tiktok video should be sent with its title');
      assert.ok(calls.some((c) => c.includes('hdplay')), 'uses the HD link');

      sent.length = 0;
      await handleMessage(sock, mk({ from: PL1, text: '.dl https://example.com/song.mp3' }));
      assert.ok(sent.some((x) => x.audio), 'direct mp3 link is sent as audio');

      sent.length = 0;
      await handleMessage(sock, mk({ from: PL1, text: '.dl https://www.youtube.com/watch?v=abc' }));
      assert.ok(/COBALT_API_URL/.test(last().text), 'no downloader set: says what is missing');
    } finally { global.fetch = realFetch; }
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
