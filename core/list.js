// The side-pane list: every space, one row each. Pure keyboard reducer: (sel, key, n) -> { sel, effect }.
// Effects: { open: index } (switch to that space) | { close: true } (close the pane).
const DOWN = new Set(["j", "down", "ArrowDown"]), UP = new Set(["k", "up", "ArrowUp"]);

export function nextList(sel, key, n, shift = false) {
  const last = Math.max(0, n - 1), clamp = (v) => Math.max(0, Math.min(last, v));
  if (DOWN.has(key)) return { sel: clamp(sel + 1), effect: null };
  if (UP.has(key)) return { sel: clamp(sel - 1), effect: null };
  if (key === "G" || (key === "g" && shift) || key === "end") return { sel: last, effect: null };
  if (key === "g" || key === "home") return { sel: 0, effect: null };
  if ((key === "enter" || key === "Enter") && n > 0) return { sel: clamp(sel), effect: { open: clamp(sel) } };
  if (key === "q") return { sel, effect: { close: true } };
  return { sel: clamp(sel), effect: null };
}
