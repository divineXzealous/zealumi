// Some "reasoning" models write their thinking into the reply
// ("The user says Wsp. We need to respond... final answer: ..."). This removes it.
const THINK_BLOCK = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;

// Strong signs of leaked thinking (two or more of these = the reply is leaking)
const STRONG = [
  /\bthe user (?:says|said|is|wrote|asks|asked|wants)\b/i,
  /\buser\s*:/i,
  /\bwe (?:need|should|must|have to|answer|respond)\b/i,
  /\bshould (?:reply|respond|answer)\b/i,
  /\bfinal answer\b/i,
  /\bconsistent with (?:the )?persona\b/i,
  /\bkeep (?:it )?short\b/i,
  /\blet'?s (?:craft|think|produce|write|draft)\b/i,
];
// Weaker signs, only used to decide which sentences to throw away once a leak is confirmed
const WEAK = [/\bmaybe\b/i, /\bpersona\b/i, /\bso respond\b/i, /\bmight be (?:okay|fine)\b/i, /\bmore insulting\b/i, /\bour (?:response|reply|answer)\b/i];

const isLeakSentence = (s) => STRONG.some((r) => r.test(s)) || WEAK.some((r) => r.test(s));

// Returns { text, leaked }. text is '' when nothing usable is left.
function stripReasoning(raw) {
  let t = String(raw || '').replace(THINK_BLOCK, '').replace(/<\/?(?:think|thinking|reasoning)>/gi, '').trim();
  const hits = STRONG.filter((r) => r.test(t)).length;
  if (hits < 2) return { text: t, leaked: false };

  // Keep only the run of clean sentences at the very end: that's the real answer.
  const sentences = t.match(/[^.?!]+[.?!]+["”']*/g) || [t];
  const out = [];
  for (let i = sentences.length - 1; i >= 0 && !isLeakSentence(sentences[i]); i--) out.unshift(sentences[i].trim());
  return { text: out.join(' ').trim(), leaked: true };
}

module.exports = { stripReasoning };
