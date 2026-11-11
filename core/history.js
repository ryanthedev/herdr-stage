// Space history: where you've been, in order, with back and forward like a browser (or vim's jumplist).
// Pure: hosts pass the shown space and the time, and keep the returned value (Stage saves it in shared state).
//
// h: { log: [{ id, at }], pos } — log is oldest first; pos is the entry you're on.
// A new visit (not reached by back/forward) is appended and pos moves to the end; nothing is cut, so the
// log stays a true record of every switch. Back/forward only move pos.

export const MAX = 200;
export const EMPTY = { log: [], pos: -1 };

// The shown space is now `id`. The entry at pos already being `id` (back/forward landing, or no change) is
// not a new visit.
export function visit(h, id, now) {
  h = h ?? EMPTY;
  if (!id || h.log[h.pos]?.id === id) return h;
  const log = [...h.log, { id, at: now }].slice(-MAX);
  return { log, pos: log.length - 1 };
}

// Back (dir -1) or forward (dir 1) from pos: the next entry that still exists and isn't the space you're in.
// Returns { h, target } with pos on the target, or target null (nothing that way) and h unchanged.
export function step(h, dir, exists = () => true) {
  h = h ?? EMPTY;
  const cur = h.log[h.pos]?.id;
  for (let i = h.pos + dir; i >= 0 && i < h.log.length; i += dir) {
    const id = h.log[i].id;
    if (id !== cur && exists(id)) return { h: { ...h, pos: i }, target: id };
  }
  return { h, target: null };
}

// Each space once, the most recent visit first: [{ id, at, visits }]. `exists` drops closed spaces.
export function recent(h, exists = () => true) {
  const out = new Map();
  for (let i = (h?.log.length ?? 0) - 1; i >= 0; i--) {
    const { id, at } = h.log[i];
    if (!exists(id)) continue;
    const r = out.get(id);
    if (r) r.visits += 1; else out.set(id, { id, at, visits: 1 });
  }
  return [...out.values()];
}

// "now", "3m", "2h", "4d": how long ago, short enough for a chip.
export function ago(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
