// Extra request settings that stop reasoning models from sending their thinking.
// Only added for the models that support them (documented by Groq).
function groqParams(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('gpt-oss')) return { include_reasoning: false, reasoning_effort: 'low' };
  if (m.includes('qwen3') || m.includes('deepseek-r1')) return { reasoning_format: 'hidden' };
  return {};
}
module.exports = { groqParams };
