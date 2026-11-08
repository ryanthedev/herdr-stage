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

// The agent's own ask: its "What you need to do:" line (plus the options under it when the line ends in
// a colon), else its last question. Ported from the POC's recap.py.
const ASK_HEAD = /\*\*(?:What you need to do|Your move|Next step for you|Action needed)[^*]*\*\*:?\s*/i;
export function extractAsk(text) {
  const t = String(text ?? "");
  const m = ASK_HEAD.exec(t);
  let ask = null;
  if (m) {
    const rest = t.slice(m.index + m[0].length).split("\n");
    ask = rest[0].trim().replace(/^[-*]\s*/, "");
    if (ask.endsWith(":")) {
      const opts = rest.slice(1).map((l) => l.trim()).filter(Boolean).slice(0, 3).map((l) => l.replace(/^[-*\d.\s]+/, ""));
      ask = `${ask} ${opts.join(" / ")}`.trim();
    }
  }
  const qs = t.split("\n").map((l) => l.trim()).filter((l) => l.endsWith("?"));
  return { ask: ask ? clean(ask).slice(0, 280) : null, question: qs.length ? clean(qs.at(-1)).slice(0, 200) : null };
}

export const clean = (s) => String(s ?? "").replace(/\*+/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();

// What the user should do about this agent, strongest source first, or null. Working agents have no move:
// their message is still changing.
export function moveOf(a) {
  if (a.state === "blocked") return { text: a.msg || "Waiting for your approval", rank: 4 };
  if (a.state === "working") return null;
  if (a.ask) return { text: a.yourMove || a.ask, rank: 3 };            // the model's version reads shorter
  if (a.yourMove) return { text: a.yourMove, rank: 2 };
  if (a.question) return { text: a.question, rank: 1 };
  return null;
}
