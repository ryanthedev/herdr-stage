// Telescope-style fuzzy search over the cards. Pure.
//
// fuzzy(query, text): the query's characters must appear in order (case-insensitive). Score rewards
// consecutive runs and matches at word starts, and penalises gaps, so "hm" ranks "herdr-md" above
// "homebrew-misc". Returns { score, at: [indices into text] } or null when it doesn't match.
const SEP = /[\s\-_/.~:⎇·]/;

export function fuzzy(query, text) {
  const q = String(query ?? "").toLowerCase().replace(/\s+/g, ""), t = String(text ?? ""), lt = t.toLowerCase();
  if (!q) return { score: 0, at: [] };
  // Greedy left-to-right, then a second pass from each later start of the first char, keep the best.
  let best = null;
  for (let start = lt.indexOf(q[0]); start >= 0; start = lt.indexOf(q[0], start + 1)) {
    const at = [];
    let j = start;
    for (const ch of q) {
      j = lt.indexOf(ch, at.length ? at[at.length - 1] + 1 : start);
      if (j < 0) break;
      at.push(j);
    }
    if (at.length < q.length) break;
    let score = 0;
    at.forEach((p, i) => {
      score += 1;
      if (p === 0 || SEP.test(t[p - 1])) score += 3;          // word start
      if (i > 0 && p === at[i - 1] + 1) score += 2;            // consecutive
      if (i > 0) score -= Math.min(3, (p - at[i - 1] - 1) * 0.2); // gap
    });
    score -= at[0] * 0.05; // earlier is slightly better
    if (!best || score > best.score) best = { score, at };
  }
  return best;
}

// cards: [{ id, fields: [{ key, text, weight }] }]. Every whitespace-separated word of the query must
// match some field (so "stage main" finds the space named stage on branch main). The card's score is the
// sum over words of its best weighted field score. -> [{ id, score, hits: { [key]: indices } }], best first.
export function search(query, cards) {
  const words = String(query ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return cards.map((c) => ({ id: c.id, score: 0, hits: {} }));
  const out = [];
  for (const c of cards) {
    let total = 0;
    const hits = {};
    let ok = true;
    for (const w of words) {
      let top = null;
      for (const f of c.fields) {
        const m = fuzzy(w, f.text);
        if (m && (!top || m.score * (f.weight ?? 1) > top.s)) top = { s: m.score * (f.weight ?? 1), key: f.key, at: m.at };
      }
      if (!top) { ok = false; break; }
      total += top.s;
      hits[top.key] = [...(hits[top.key] ?? []), ...top.at];
    }
    if (ok) out.push({ id: c.id, score: total, hits });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Search keys while the prompt is open: printable characters edit the query, backspace deletes,
// ctrl-n/ctrl-p or arrows move, enter opens, esc closes. -> { query, sel, effect }
// effect: { open: index } | { close: true } | null. n = number of results.
export function nextSearch(st, key, n, mods = {}) {
  const last = Math.max(0, n - 1), clamp = (v) => Math.max(0, Math.min(last, v));
  if (key === "escape" || key === "Escape") return { ...st, effect: { close: true } };
  if (key === "enter" || key === "Enter") return { ...st, effect: n > 0 ? { open: clamp(st.sel) } : null };
  if (key === "down" || key === "ArrowDown" || (mods.control && (key === "n" || key === "j"))) return { ...st, sel: clamp(st.sel + 1), effect: null };
  if (key === "up" || key === "ArrowUp" || (mods.control && (key === "p" || key === "k"))) return { ...st, sel: clamp(st.sel - 1), effect: null };
  if (key === "backspace" || key === "Backspace") return { query: st.query.slice(0, -1), sel: 0, effect: null };
  if (mods.control && key === "u") return { query: "", sel: 0, effect: null };
  if (!mods.control && !mods.platform && typeof key === "string" && [...key].length === 1) return { query: st.query + key, sel: 0, effect: null };
  if (key === "space") return { query: st.query + " ", sel: 0, effect: null };
  return { ...st, effect: null };
}
