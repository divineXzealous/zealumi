// Offline tests: no WhatsApp, no real API calls. Run with: npm test
process.env.DATA_DIR = require('os').tmpdir() + '/lumi-test-' + Date.now();
process.env.GROQ_API_KEY = 'groq-test-key-123';
process.env.DEEPSEEK_API_KEY = 'deepseek-test-key-123';
process.env.GEMINI_API_KEY = 'gemini-test-key-123';
process.env.PROTECTED_CONTACT_ID = '2348000000001,99887766';
process.env.MEMORY_LIMIT = '4';

const assert = require('assert');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('  ok  ', name); };

(async () => {
  // --- fallback chain with a fake fetch ---
  const calls = [];
  const reply = (status, body) => ({ ok: status === 200, status, headers: { get: () => null }, json: async () => body });
  let plan = {};
  global.fetch = async (url) => {
    const p = url.includes('groq') ? 'groq' : url.includes('deepseek') ? 'deepseek' : 'gemini';
    calls.push(p);
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
  await test('429 on Groq falls back to DeepSeek', async () => {
    plan = { groq: 429, deepseek: 200, gemini: 200 };
    calls.length = 0;
    assert.strictEqual((await fb.generate(msgs)).provider, 'DeepSeek');
  });
  await test('Groq is skipped while cooling down (no wasted calls)', async () => {
    calls.length = 0;
    await fb.generate(msgs);
    assert.ok(!calls.includes('groq'));
  });
  await test('DeepSeek 500 falls to Gemini', async () => {
    plan = { groq: 429, deepseek: 500, gemini: 200 };
    assert.strictEqual((await fb.generate(msgs)).provider, 'Gemini');
  });
  await test('everything failing returns null (no infinite retry)', async () => {
    plan = { groq: 500, deepseek: 500, gemini: 'hang' };
    assert.strictEqual(await fb.generate(msgs), null);
  });

  // --- memory ---
  const memory = require('./memory');
  await test('memory is per-user, limited and clearable', async () => {
    for (let i = 0; i < 6; i++) memory.add('a', 'user', 'm' + i);
    memory.add('b', 'user', 'other');
    assert.strictEqual(memory.get('a').length, 4);
    assert.strictEqual(memory.get('b').length, 1);
    memory.clear('a');
    assert.strictEqual(memory.get('a').length, 0);
    assert.strictEqual(memory.get('b').length, 1);
  });

  // --- Divine protection ---
  const divine = require('./divine');
  await test('Divine: only fires on real mention in a group', async () => {
    const base = { isGroup: true, jid: 'g1@g.us', senderNum: '111', mentioned: [] };
    assert.strictEqual(divine.check(base), null);
    assert.strictEqual(divine.check({ ...base, isGroup: false, mentioned: ['2348000000001@s.whatsapp.net'] }), null);
    assert.ok(divine.check({ ...base, mentioned: ['2348000000001@s.whatsapp.net'] }));
  });
  await test('Divine: cooldown stops spam, LID id also matches', async () => {
    const c = { isGroup: true, jid: 'g1@g.us', senderNum: '111', mentioned: ['99887766@lid'] };
    assert.strictEqual(divine.check(c), null); // inside cooldown from previous test
    assert.ok(divine.check({ ...c, jid: 'g2@g.us' }));
  });

  // --- menu ---
  const { buildMenu } = require('./menu');
  await test('menu is generated from the registered list only', async () => {
    const t = buildMenu([{ name: 'ping', category: 'GENERAL', menu: ['ping'] }, { name: 'ai', category: 'AI SYSTEM', menu: ['ai on'] }]);
    assert.ok(t.includes('◈ .ping') && t.includes('◈ .ai on'));
    assert.ok(!t.includes('.play'));
    assert.ok(t.endsWith('Choose a command. I suppose.'));
  });

  // --- dedupe + logger scrubbing ---
  const { isDuplicate } = require('./dedupe');
  await test('duplicate messages are blocked', async () => {
    assert.strictEqual(isDuplicate('x1'), false);
    assert.strictEqual(isDuplicate('x1'), true);
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
