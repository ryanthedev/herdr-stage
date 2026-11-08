// The canvas level: one space drawn as a tree (space -> tabs -> agents -> helpers), and its keyboard
// behaviour. Pure: positions are computed from fixed node sizes, so any skin can draw them.
import { agentRow } from "./stage.js";

export const SIZE = { rootW: 320, tabW: 90, agentW: 440, colGap: 60, rowGap: 24, groupGap: 44 };

// Agent card height from what it shows: title + meta, then a status line, then a your-move box.
export const agentH = (r) => 96 + (r.line ? 56 : 0) + (r.move ? 80 : 0);

// space: { id, name, folder, git, agents: [{ addr, parent?, tab, ... }] } -> { nodes, edges, bbox }
export function layoutCanvas(space) {
  const S = SIZE, rows = space.agents.map((a) => ({ ...agentRow(a), tab: a.tab, parent: a.parent ?? null }));
  const nodes = [], edges = [];
  const root = { id: "root", kind: "root", x: 0, y: 0, w: S.rootW, h: 110 };
  nodes.push(root);
  const xTab = S.rootW + S.colGap, xAgent = xTab + S.tabW + S.colGap, xHelper = xAgent + S.agentW + S.colGap;
  const tabs = [...new Set(rows.filter((r) => !r.parent).map((r) => r.tab))];
  let y = 0;
  for (const t of tabs) {
    const top = y, tn = { id: `tab:${t}`, kind: "tab", label: /^\d+$/.test(String(t)) ? `tab ${t}` : String(t), x: xTab, y: 0, w: S.tabW, h: 36 };
    nodes.push(tn); edges.push([root.id, tn.id]);
    for (const r of rows.filter((r) => r.tab === t && !r.parent)) {
      const an = { id: r.addr, kind: "agent", row: r, x: xAgent, y, w: S.agentW, h: agentH(r) };
      nodes.push(an); edges.push([tn.id, an.id]);
      let ky = y;
      for (const k of rows.filter((k) => k.parent === r.addr)) {
        const kn = { id: k.addr, kind: "agent", row: k, x: xHelper, y: ky, w: S.agentW, h: agentH(k) };
        nodes.push(kn); edges.push([an.id, kn.id]); ky += kn.h + S.rowGap;
      }
      y = Math.max(y + an.h + S.rowGap, ky) ;
    }
    tn.y = top + Math.max(0, (y - S.rowGap - top) / 2 - tn.h / 2);
    y += S.groupGap;
  }
  root.y = Math.max(0, (y - S.groupGap) / 2 - root.h / 2);
  const bbox = { x0: 0, y0: 0, x1: Math.max(...nodes.map((n) => n.x + n.w)), y1: Math.max(...nodes.map((n) => n.y + n.h)) };
  return { nodes, edges, bbox, byId: Object.fromEntries(nodes.map((n) => [n.id, n])) };
}

// Elbow edges as axis-aligned segments: out of the parent, down a spine just left of the child, into it.
export function edgeSegments(layout) {
  const segs = [];
  for (const [p, c] of layout.edges) {
    const a = layout.byId[p], b = layout.byId[c];
    const py = a.y + (a.kind === "agent" ? 30 : a.h / 2), cy = b.y + (b.kind === "agent" ? 30 : b.h / 2), sx = b.x - 28;
    segs.push({ x: a.x + a.w + 6, y: py, w: Math.max(0, sx - (a.x + a.w + 6)), h: 0, hot: Boolean(b.row?.move) });
    segs.push({ x: sx, y: Math.min(py, cy), w: 0, h: Math.abs(cy - py), hot: Boolean(b.row?.move) });
    segs.push({ x: sx, y: cy, w: b.x - 6 - sx, h: 0, hot: Boolean(b.row?.move) });
  }
  return segs;
}

// Arrow keys go to the nearest agent in that direction by position (tabs and the title aren't stops):
// the gap along the arrow plus the sideways gap, so the closest box above wins across columns.
export function nearest(layout, fromId, dir) {
  const cur = layout.byId[fromId]; if (!cur) return fromId;
  const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  let best = fromId, bd = Infinity;
  for (const n of layout.nodes) {
    if (n.kind !== "agent" || n.id === fromId) continue;
    const along = dx ? (dx > 0 ? n.x - (cur.x + cur.w) : cur.x - (n.x + n.w)) : (dy > 0 ? n.y - (cur.y + cur.h) : cur.y - (n.y + n.h));
    if (along < -8) continue;
    const side = dx ? Math.max(0, n.y - (cur.y + cur.h), cur.y - (n.y + n.h)) : Math.max(0, n.x - (cur.x + cur.w), cur.x - (n.x + n.w));
    const d = Math.max(0, along) + side;
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}

// Camera: the world offset that frames the whole tree when it fits, else follows the selection without
// showing empty space past the tree. Viewport in the same px as the layout.
export function camera(layout, selId, vw, vh, pad = 48) {
  const { x0, y0, x1, y1 } = layout.bbox, bw = x1 - x0, bh = y1 - y0, n = layout.byId[selId] ?? layout.nodes[0];
  const fit = (span, view, lo) => (view - span) / 2 - lo;
  const follow = (c, view, lo, hi) => Math.min(pad - lo, Math.max(view - pad - hi, view / 2 - c));
  return {
    x: bw + 2 * pad <= vw ? fit(bw, vw, x0) : follow(n.x + n.w / 2, vw, x0, x1),
    y: bh + 2 * pad <= vh ? fit(bh, vh, y0) : follow(n.y + n.h / 2, vh, y0, y1),
  };
}

export const firstAgent = (layout, preferMove = true) =>
  (preferMove && layout.nodes.find((n) => n.kind === "agent" && n.row.move)) || layout.nodes.find((n) => n.kind === "agent");
