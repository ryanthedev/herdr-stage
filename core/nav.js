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
    else if (key === "enter" || key === "Enter" || dir === "right") return { state: s, effect: rows[s.row] && { open: "agent", space: vm.cards[s.card].id, pane: rows[s.row].pane } };
    else if (key === "escape" || key === "Escape" || key === "space" || key === " " || dir === "left") s.zone = "cards";
    return { state: s, effect: null };
  }
  if (key === "escape" || key === "Escape") return { state: s, effect: { close: true } };
  if (key === "tab" || key === "Tab") { s.zone = s.zone === "lane" ? "cards" : vm.lane.length ? "lane" : "cards"; return { state: s, effect: null }; }
  if (/^[1-9]$/.test(key) && +key <= n) { s.zone = "cards"; s.card = +key - 1; return { state: s, effect: null }; }
  if (s.zone === "lane") {
    if (dir === "left") s.lane = clamp(s.lane - 1, 0, vm.lane.length - 1);
    else if (dir === "right") s.lane = clamp(s.lane + 1, 0, vm.lane.length - 1);
    else if (dir === "down") s.zone = "cards";
    else if (key === "enter" || key === "Enter") { const m = vm.lane[s.lane]; return { state: s, effect: m && { open: "agent", space: m.space, pane: m.pane } }; }
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
