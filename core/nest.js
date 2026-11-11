// Spaces inside spaces. A space nests under another when any terminal in it carries the label
// `stage.parent=<space name or id>` (`hc label <t> stage.parent=upublish`). Pure.

export function labelsOf(t) {
  const l = t?.labels;
  if (!l) return {};
  if (Array.isArray(l)) return Object.fromEntries(l.map((s) => String(s).split("=")).map(([k, ...v]) => [k, v.join("=")]));
  return l;
}

// The space a terminal sits in, as spaces() names it. A remote terminal ("vana/t9") reports its space
// without the machine ("sp…"), while spaces() lists it as "vana/sp…": add the machine back.
export function spaceIdOf(t, agentSpace = {}) {
  const raw = labelsOf(t)["herdr.space"] ?? agentSpace[t?.address] ?? null;
  const machine = String(t?.address ?? "").includes("/") ? String(t.address).split("/")[0] : null;
  return raw && machine && !raw.includes("/") ? `${machine}/${raw}` : raw;
}

const machineOf = (id) => (String(id).includes("/") ? String(id).split("/")[0] : "");

// -> { [childSpaceId]: parentSpaceId }. spaceOf(terminal) says which space a terminal sits in.
// A parent named by name is looked for on the child's own machine first (two machines can each have a
// "scratch"), then anywhere.
// Unknown parents, self-parents and cycles are dropped (the space stays top level).
export function parentsOf(terminals, spaces, spaceOf) {
  const ids = new Set(spaces.map((s) => s.id));
  const named = (name, child) => {
    const all = spaces.filter((s) => s.name === name);
    return (all.find((s) => machineOf(s.id) === machineOf(child)) ?? all[0])?.id;
  };
  const parent = {};
  for (const t of terminals) {
    const want = labelsOf(t)["stage.parent"], child = spaceOf(t);
    if (!want || !child || parent[child]) continue;
    const p = ids.has(want) ? want : named(want, child);
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

// How each row of the display list sits in its family, for drawing: { fam, first, last, rails, elbow }.
// fam: the family's root id, or null for a space with no nesting (no parent shown, no kids shown).
// first / last: the family's top row and bottom row (a panel rounds those corners; no divider inside).
// elbow: the level (depth - 1) whose rail turns into this row, or -1 for the root.
// rails: the levels whose rail runs the full height of this row, because a later row of the family still
// hangs off them. The root's own rail (level 0 below its header) is in rails when it has kids.
export function familyMarks(list) {
  const ids = new Set(list.map((e) => e.id)), byId = new Map(list.map((e) => [e.id, e]));
  const rootOf = (e) => { let r = e; while (r.parent && ids.has(r.parent)) r = byId.get(r.parent); return r.id; };
  const roots = list.map(rootOf);
  const hasKids = new Set(list.filter((e) => e.parent && ids.has(e.parent)).map((e) => roots[list.indexOf(e)]));
  return list.map((e, i) => {
    const fam = hasKids.has(roots[i]) ? roots[i] : null;
    if (!fam) return { fam: null, first: false, last: false, rails: [], elbow: -1 };
    const d = e.parent && ids.has(e.parent) ? e.depth : 0;
    const rails = [];
    // Level L carries on below row i when a later row of this family, before the family leaves level L,
    // sits at depth L + 1 (another child of the same ancestor).
    for (let L = 0; L <= d; L++) {
      for (let j = i + 1; j < list.length && roots[j] === fam; j++) {
        const dj = list[j].depth;
        if (dj <= L) break;
        if (dj === L + 1) { rails.push(L); break; }
      }
    }
    return { fam, first: roots[i - 1] !== fam, last: roots[i + 1] !== fam, rails, elbow: d ? d - 1 : -1 };
  });
}
