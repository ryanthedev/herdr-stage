// Stage keyboard behaviour as a pure reducer: (state, key, vm, cols) -> { state, effect }.
// Zones: "lane" (your-move strip), "cards" (pick a space), "agents" (inside one card, pick an agent).
// Effects are what the host does: { open: "space", space } | { open: "agent", space, pane } | { close: true }.

export const initial = (vm) => ({ zone: vm.lane.length ? "lane" : "cards", lane: 0, card: 0, row: 0 });

const DIR = { ArrowLeft: "left", h: "left", left: "left", ArrowRight: "right", l: "right", right: "right",
  ArrowUp: "up", k: "up", up: "up", ArrowDown: "down", j: "down", down: "down" };

export function next(st, key, vm, cols = 4) {
  const s = { ...st }, dir = DIR[key], n = vm.cards.length;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  if (s.zone === "agents") {
    const rows = vm.cards[s.card]?.rows ?? [];
    if (dir === "down") s.row = clamp(s.row + 1, 0, rows.length - 1);
    else if (dir === "up") s.row = clamp(s.row - 1, 0, rows.length - 1);
    else if (key === "enter" || key === "Enter" || dir === "right") return { state: s, effect: rows[s.row] && { open: "agent", space: vm.cards[s.card].id, pane: rows[s.row].pane, addr: rows[s.row].addr } };
    else if (key === "escape" || key === "Escape" || key === "space" || key === " " || dir === "left") s.zone = "cards";
    return { state: s, effect: null };
  }
  if (key === "escape" || key === "Escape") return { state: s, effect: { close: true } };
  if (key === "t") return { state: s, effect: { theme: "toggle" } };
  if (key === "tab" || key === "Tab") { s.zone = s.zone === "lane" ? "cards" : vm.lane.length ? "lane" : "cards"; return { state: s, effect: null }; }
  if (/^[1-9]$/.test(key) && +key <= n) { s.zone = "cards"; s.card = +key - 1; return { state: s, effect: null }; }
  if (s.zone === "lane") {
    if (dir === "left") s.lane = clamp(s.lane - 1, 0, vm.lane.length - 1);
    else if (dir === "right") s.lane = clamp(s.lane + 1, 0, vm.lane.length - 1);
    else if (dir === "down") s.zone = "cards";
    else if (key === "enter" || key === "Enter") { const m = vm.lane[s.lane]; return { state: s, effect: m && { open: "agent", space: m.space, pane: m.pane, addr: m.addr } }; }
    return { state: s, effect: null };
  }
  // cards: a grid of `cols` columns in reading order
  if (dir === "left" && s.card % cols) s.card -= 1;
  else if (dir === "right" && s.card % cols < cols - 1 && s.card + 1 < n) s.card += 1;
  else if (dir === "down" && s.card + cols < n) s.card += cols;
  else if (dir === "up") { if (s.card - cols >= 0) s.card -= cols; else if (vm.lane.length) s.zone = "lane"; }
  else if (key === "enter" || key === "Enter") return { state: s, effect: { open: "space", space: vm.cards[s.card].id } };
  else if ((key === "space" || key === " ") && vm.cards[s.card]?.rows.length) { s.zone = "agents"; s.row = 0; }
  return { state: s, effect: null };
}

// Canvas keys: (cst, key, layout, view) -> { state, effect }. cst = { sel, drawer, zoom?, zoomSet? };
// view = { vw, vh } (the canvas viewport, for the fit zoom). zoomSet false means "fit": + and - start from it.
// Effects: { open: "agent", pane } | { back: true } (to the stage) | { theme: "toggle" }.
import { nearest, fitZoom, clampZoom, ZOOM } from "./canvas.js";
// view.fit, when given, is the fit zoom the host is showing (it may draw a smaller layout than it navigates).
export const zoomOf = (cst, layout, view) => (cst.zoomSet ? cst.zoom : view?.fit ?? fitZoom(layout, view?.vw ?? 1600, view?.vh ?? 1000));
export function nextCanvas(cst, key, layout, view) {
  const s = { ...cst }, dir = DIR[key];
  if (key === "t") return { state: s, effect: { theme: "toggle" } };
  if (key === "+" || key === "=" || key === "-") {
    s.zoom = clampZoom(zoomOf(cst, layout, view) + (key === "-" ? -ZOOM.step : ZOOM.step)); s.zoomSet = true;
    return { state: s, effect: null };
  }
  if (key === "0") { s.zoomSet = false; return { state: s, effect: null }; }
  if (dir) { s.sel = nearest(layout, s.sel, dir); return { state: s, effect: null }; }
  if (key === "escape" || key === "Escape") { if (s.drawer) { s.drawer = false; return { state: s, effect: null }; } return { state: s, effect: { back: true } }; }
  if (key === "space" || key === " ") { s.drawer = !s.drawer; return { state: s, effect: null }; }
  if (key === "enter" || key === "Enter") { const n = layout.byId[s.sel]; return { state: s, effect: n?.row ? { open: "agent", pane: n.row.pane, addr: n.row.addr } : null }; }
  if (key === "n") {
    const moves = layout.nodes.filter((n) => n.kind === "agent" && n.row.move);
    if (moves.length) { const i = moves.findIndex((n) => n.id === s.sel); s.sel = moves[(i + 1) % moves.length].id; }
    return { state: s, effect: null };
  }
  return { state: s, effect: null };
}
