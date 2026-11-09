// The three AI providers. Each has: name, enabled(), call(messages) -> text.
// messages = [{role:'system'|'user'|'assistant', content}]
const config = require('../../config');
const { request } = require('../utils/http');

function openAiStyle(name, url, cfg) {
  return {
    name,
    model: () => cfg.model,
    enabled: () => Boolean(cfg.key),
    async call(messages) {
      const data = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, messages, temperature: 0.8, max_tokens: config.ai.maxTokens }),
        timeoutMs: config.ai.timeoutMs,
      });
      return (data?.choices?.[0]?.message?.content || '').trim();
    },
  };
}

const groq = openAiStyle('Groq', 'https://api.groq.com/openai/v1/chat/completions', config.ai.groq);
const deepseek = openAiStyle('DeepSeek', 'https://api.deepseek.com/chat/completions', config.ai.deepseek);

const gemini = {
  name: 'Gemini',
  model: () => config.ai.gemini.model,
  enabled: () => Boolean(config.ai.gemini.key),
  async call(messages) {
    const cfg = config.ai.gemini;
    const system = messages.find((m) => m.role === 'system');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const data = await request(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
      {
        method: 'POST',
        // Key goes in a header (not the URL) so it can never leak into logs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system.content }] } : undefined,
          contents,
          generationConfig: { temperature: 0.8, maxOutputTokens: config.ai.maxTokens },
        }),
        timeoutMs: config.ai.timeoutMs,
      }
    );
    return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  },
};

// Order = priority: Groq (primary), DeepSeek (fallback 1), Gemini (fallback 2).
module.exports = [groq, deepseek, gemini];
