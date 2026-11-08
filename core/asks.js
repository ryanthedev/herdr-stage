// Asks: what an agent's message wants from the user. Pure.

// Hand-offs that don't read as instructions: "#218 is waiting for you", "stays yours",
// "needs your review", "your call", "over to you". The model missed these as asks once
// (2026-11-08, upublish lead); this rule is the backstop when the model says nothing is needed.
const HANDOFF = [
  /\b(?:is|are|stays?|remains?)\s+(?:still\s+)?(?:waiting\s+)?(?:for|on)\s+you\b/i,
  /\b(?:stays?|remains?|is|are)\s+yours\b/i,
  /\bneeds?\s+(?:you|your\s+(?:review|approval|decision|input|ok|go[- ]ahead|answer|call))\b/i,
  /\b(?:your\s+call|over\s+to\s+you|up\s+to\s+you|blocked\s+on\s+you|waiting\s+on\s+your)\b/i,
  /\bwhen\s+you(?:'re|\s+are)\s+back\b/i,
];

// The sentence in `text` that hands work to the user, or null. Skips offers ("if you want, I can…").
export function handoff(text) {
  const sentences = String(text ?? "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    if (/\b(?:if you(?:'d)? (?:want|like)|I can also)\b/i.test(s)) continue;
    if (HANDOFF.some((re) => re.test(s))) return s.trim();
  }
  return null;
}
