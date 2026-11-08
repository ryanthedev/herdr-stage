// Summary-on-idle: the pure part. No I/O, no Herdr, no model calls; every host
// (the Node job, the Herdr mod, tests) feeds it plain objects.

// Agents are summarized once they stop: a working agent's message changes every
// few seconds, so a summary of it is stale before it lands.
export const SUMMARY_STATES = new Set(["done", "idle", "blocked"]);

export const SYSTEM =
  "You read the last message a coding agent wrote to its user and report two things, as JSON only. " +
  'Shape: {"recap": string, "your_move": string|null}. ' +
  "recap: one plain sentence, at most 18 words, saying where the work stands. No markdown. " +
  "your_move: if the message asks the user to do, decide, test, approve or answer something, " +
  "one imperative sentence of at most 20 words saying exactly what; otherwise null. " +
  "A hand-off is an ask too: when the message says something is waiting for, on, or with the user " +
  "('#218 is waiting for you', '#218 stays yours', 'needs your review', 'your call'), your_move names it " +
  "as an action ('Pick up #218, which is waiting for you'). " +
  "Offers like 'I can also do X if you want' are not asks: null.";

// Does this agent need a (new) summary? `cached` is what the store holds for it.
export function needsSummary(agent, cached, { force = false } = {}) {
  if (!agent?.text || !agent.at) return false;
  if (force) return true;
  if (!SUMMARY_STATES.has(agent.state)) return false;
  return !cached || cached.at !== agent.at;
}

// The prompt: the message's tail (the ask is usually at the end), with where it came from.
export function buildPrompt({ space, title, text }, maxChars = 6000) {
  const body = text.length > maxChars ? "…" + text.slice(-maxChars) : text;
  return `Space: ${space ?? "?"}\nAgent title: ${title ?? "?"}\n\nLast message:\n"""\n${body}\n"""`;
}

// The model's reply, validated. Throws on anything that isn't the promised shape.
export function parseSummary(reply) {
  const raw = String(reply ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in reply");
  const o = JSON.parse(raw.slice(start, end + 1));
  if (typeof o.recap !== "string" || !o.recap.trim()) throw new Error("recap missing");
  const mv = typeof o.your_move === "string" ? o.your_move.trim() : null;
  return { recap: o.recap.trim(), yourMove: mv && !/^(none|null|n\/a)$/i.test(mv) ? mv : null };
}

// The model's summary plus the rule backstop: a hand-off sentence in the message is an ask even when
// the model returned null for your_move.
export function withHandoff(summary, text, handoffOf) {
  if (summary.yourMove) return summary;
  const h = handoffOf(text);
  return h ? { ...summary, yourMove: h, source: "rule" } : summary;
}

// The cache record kept per agent address.
export function record(agent, summary, meta = {}) {
  return { at: agent.at, sessionId: agent.sessionId ?? null, recap: summary.recap, yourMove: summary.yourMove, ...meta, made: new Date().toISOString() };
}
