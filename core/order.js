// Which spaces come first. Pure: hosts pass plain objects and the time.
//
// 1. Any space with a blocked agent or an open ask (your move) sits at the top.
// 2. The rest by one score: how long you've been in it and how often you switch to it (both decaying with
//    a half-life of HALF_LIFE_H hours), plus how recently anything in it happened.
//
// Presence is recorded by Stage itself (Herdr keeps no history of where you were): `track` is called on
// every render and every refresh tick with the shown space, and the store is saved in shared state.

export const HALF_LIFE_H = 72;
const decay = (ms) => Math.pow(0.5, ms / (HALF_LIFE_H * 3600000));
const MAX_STEP_MS = 30000; // a gap longer than this (pane closed, laptop asleep) is not time spent in a space

// store: { [spaceId]: { dwell: decayed minutes, visits: decayed count, last: ms } }, plus _at and _active.
export function track(store, activeId, now) {
  const s = { ...(store ?? {}) };
  const prevAt = s._at ?? now, prevActive = s._active ?? null, dt = Math.max(0, now - prevAt);
  const k = decay(dt);
  for (const id of Object.keys(s)) {
    if (id.startsWith("_")) continue;
    s[id] = { ...s[id], dwell: s[id].dwell * k, visits: s[id].visits * k };
  }
  if (activeId) {
    const e = (s[activeId] ??= { dwell: 0, visits: 0, last: 0 });
    if (prevActive === activeId) e.dwell += Math.min(dt, MAX_STEP_MS) / 60000;
    if (prevActive !== activeId) e.visits += 1;
    e.last = now;
  }
  s._at = now;
  s._active = activeId ?? null;
  return s;
}

// Drop spaces that no longer exist so the saved store doesn't grow forever.
export function prune(store, ids) {
  const keep = new Set(ids), s = {};
  for (const [k, v] of Object.entries(store ?? {})) if (k.startsWith("_") || keep.has(k)) s[k] = v;
  return s;
}

// A space's score. activityAt: the latest moment anything in it changed (ms), or null.
export function scoreOf(entry, activityAt, now) {
  const dwell = entry?.dwell ?? 0, visits = entry?.visits ?? 0;
  const recent = Math.max(entry?.last ?? 0, activityAt ?? 0);
  const ageH = recent ? Math.max(0, now - recent) / 3600000 : Infinity;
  // Minutes in the space, a switch worth five minutes, and up to an hour's worth for "just now".
  return dwell + 5 * visits + (Number.isFinite(ageH) ? 60 * Math.pow(0.5, ageH / 6) : 0);
}

// items: [{ id, urgent: bool, activityAt }]. Returns the ids in order. Ties keep the input (sidebar) order.
export function rank(items, store, now) {
  return items.map((it, i) => ({ it, i, s: scoreOf(store?.[it.id], it.activityAt, now) }))
    .sort((a, b) => Number(b.it.urgent) - Number(a.it.urgent) || b.s - a.s || a.i - b.i)
    .map((x) => x.it.id);
}
