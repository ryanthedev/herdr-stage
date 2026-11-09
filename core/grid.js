// The side pane's card grid: every space as a card, laid out in rows of `cols`. Pure keyboard reducer:
// (sel, key, n, cols) -> { sel, effect }. h/l move along a row, j/k move a whole row, all clamped.
// Effects: { open: index } (switch to that space) | { close: true } (close the pane).
const LEFT = new Set(["h", "left", "ArrowLeft"]), RIGHT = new Set(["l", "right", "ArrowRight"]);
const DOWN = new Set(["j", "down", "ArrowDown"]), UP = new Set(["k", "up", "ArrowUp"]);

export function nextGrid(sel, key, n, cols = 1, shift = false) {
  const last = Math.max(0, n - 1), c = Math.max(1, cols), clamp = (v) => Math.max(0, Math.min(last, v));
  const s = clamp(sel);
  if (LEFT.has(key)) return { sel: clamp(s - 1), effect: null };
  if (RIGHT.has(key)) return { sel: clamp(s + 1), effect: null };
  // j on the row above a short last row lands on that row's last card rather than staying put.
  if (DOWN.has(key)) return { sel: rowOf(s, c) === rowOf(last, c) ? s : clamp(s + c), effect: null };
  if (UP.has(key)) return { sel: s - c >= 0 ? s - c : s, effect: null };
  if (key === "G" || (key === "g" && shift) || key === "end") return { sel: last, effect: null };
  if (key === "g" || key === "home") return { sel: 0, effect: null };
  if ((key === "enter" || key === "Enter") && n > 0) return { sel: s, effect: { open: s } };
  if (key === "q") return { sel: s, effect: { close: true } };
  return { sel: s, effect: null };
}

// How many cards of at least `min` px fit in `width`, with `gap` between them and `slack` kept for the scrollbar.
export function colsFor(width, min, gap = 0, slack = 0) {
  return Math.max(1, Math.floor((width - slack + gap) / (min + gap)));
}

export const rowOf = (i, cols) => Math.floor(i / Math.max(1, cols));
export const rowsFor = (n, cols) => Math.ceil(n / Math.max(1, cols));
