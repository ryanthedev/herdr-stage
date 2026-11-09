// The side pane's card grid. Cards are laid out in rows of up to `cols`; a family (a top-level space and
// the spaces nested under it) always starts a new row, so rows can be short. Pure keyboard reducer over
// those rows: h/l step through cards in order, j/k move to the row below/above at the nearest column.
// Effects: { open: index } (switch to that space) | { close: true } (close the pane).
const LEFT = new Set(["h", "left", "ArrowLeft"]), RIGHT = new Set(["l", "right", "ArrowRight"]);
const DOWN = new Set(["j", "down", "ArrowDown"]), UP = new Set(["k", "up", "ArrowUp"]);

// depths: one number per card (0 = top level). -> rows: [[cardIndex, ...], ...]
export function layoutRows(depths, cols) {
  const c = Math.max(1, cols), rows = [];
  depths.forEach((d, i) => {
    const row = rows[rows.length - 1];
    if (!row || row.length >= c || (d === 0 && i > 0)) rows.push([i]);
    else row.push(i);
  });
  return rows;
}

export function rowOf(i, rows) {
  const r = rows.findIndex((row) => row.includes(i));
  return r < 0 ? 0 : r;
}

export function nextGrid(sel, key, rows, shift = false) {
  const n = rows.reduce((a, r) => a + r.length, 0), last = Math.max(0, n - 1);
  const clamp = (v) => Math.max(0, Math.min(last, v)), s = clamp(sel);
  const vert = (dir) => {
    const r = rowOf(s, rows), to = rows[r + dir];
    if (!to) return s;
    return to[Math.min(rows[r].indexOf(s), to.length - 1)];
  };
  if (LEFT.has(key)) return { sel: clamp(s - 1), effect: null };
  if (RIGHT.has(key)) return { sel: clamp(s + 1), effect: null };
  if (DOWN.has(key)) return { sel: vert(1), effect: null };
  if (UP.has(key)) return { sel: vert(-1), effect: null };
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
