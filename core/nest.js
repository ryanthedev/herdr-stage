// Spaces inside spaces. A space nests under another when any terminal in it carries the label
// `stage.parent=<space name or id>` (`hc label <t> stage.parent=upublish`). Pure.

export function labelsOf(t) {
  const l = t?.labels;
  if (!l) return {};
  if (Array.isArray(l)) return Object.fromEntries(l.map((s) => String(s).split("=")).map(([k, ...v]) => [k, v.join("=")]));
  return l;
}

// -> { [childSpaceId]: parentSpaceId }. spaceOf(terminal) says which space a terminal sits in.
// Unknown parents, self-parents and cycles are dropped (the space stays top level).
export function parentsOf(terminals, spaces, spaceOf) {
  const byName = new Map(spaces.map((s) => [s.name, s.id])), ids = new Set(spaces.map((s) => s.id));
  const parent = {};
  for (const t of terminals) {
    const want = labelsOf(t)["stage.parent"], child = spaceOf(t);
    if (!want || !child || parent[child]) continue;
    const p = ids.has(want) ? want : byName.get(want);
    if (p && p !== child) parent[child] = p;
  }
  // Every space on a cycle goes back to top level (decided before any edge is removed).
  const onCycle = new Set();
  for (const id of Object.keys(parent)) {
    const seen = [id];
    for (let p = parent[id]; p; p = parent[p]) {
      const at = seen.indexOf(p);
      if (at >= 0) { seen.slice(at).forEach((x) => onCycle.add(x)); break; }
      seen.push(p);
    }
  }
  for (const id of onCycle) delete parent[id];
  return parent;
}

// Order a ranked list into families: every top-level space in rank order, each followed by its children
// (in rank order, recursively). A family ranks by its best member, so a blocked child lifts its parent.
// -> [{ id, depth, parent, kids }]
export function families(rankedIds, parent) {
  const pos = new Map(rankedIds.map((id, i) => [id, i])), kids = {};
  for (const id of rankedIds) if (parent[id] && pos.has(parent[id])) (kids[parent[id]] ??= []).push(id);
  const rootOf = (id) => { let r = id; while (parent[r] && pos.has(parent[r])) r = parent[r]; return r; };
  const best = {};
  for (const id of rankedIds) { const r = rootOf(id); best[r] = Math.min(best[r] ?? Infinity, pos.get(id)); }
  const roots = rankedIds.filter((id) => rootOf(id) === id).sort((a, b) => best[a] - best[b]);
  const out = [];
  const walk = (id, depth) => {
    out.push({ id, depth, parent: depth ? parent[id] : null, kids: (kids[id] ?? []).length });
    for (const k of kids[id] ?? []) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}
