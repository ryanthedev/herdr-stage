// herdr-help, the pure part: what the key list shows for a filter, what each key does while it's open,
// and which of a mod's keys Herdr takes first. No Herdr or GPUI imports, so it runs under `node --test`.
//
// A help list is sections of rows, in the order you want them read:
//   [["MOVE", [["j k", "next / previous"], ["⌘D", "duplicate", { bind: "cmd-d" }]]], ...]
// Row: [keys as shown, what it does, options?]. Keys are shown as keycaps split on single spaces
// ("ctrl-d ctrl-u" is two caps). options.bind: the same key in keys.json syntax, so takenBy() can tell
// when the person's keys.json gives it to Herdr before the mod sees it.

// Every word of the query must appear in the section title, the keys or the description.
export function filterSections(sections, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return sections;
  const hit = (title, [keys, what]) => words.every((w) => `${title} ${keys} ${what}`.toLowerCase().includes(w));
  return sections.map(([title, rows]) => [title, rows.filter((r) => hit(title, r))]).filter(([, rows]) => rows.length);
}

export const countRows = (sections) => sections.reduce((n, [, rows]) => n + rows.length, 0);

// The key that opens help: ? (some layouts report shift-/), or h when the mod passes it.
export function isHelpKey(e, { h = false } = {}) {
  const m = e?.modifiers ?? {};
  if (m.platform || m.control || m.alt) return false;
  return e.key === "?" || e.key_char === "?" || (e.key === "/" && Boolean(m.shift)) || (h && e.key === "h" && !m.shift);
}

// Keys while the list is open. st: { q, typing, y }. view: { page, max } in px (max = how far it scrolls).
// Not typing: j/k and arrows scroll a line, ctrl-d/ctrl-u half a page, g/G the ends, / starts a filter,
// any other key closes (so the key you meant still reads as "back to work"). Typing: characters edit the
// filter, Enter keeps it and returns to j/k, Esc empties it, then leaves it.
// -> { st, close: bool }
export function helpKey(st, key, mods = {}, view = {}) {
  const page = Math.max(80, view.page ?? 300), max = Math.max(0, view.max ?? 0);
  const at = (y) => ({ st: { ...st, y: Math.max(0, Math.min(max, y)) }, close: false });
  if (st.typing) {
    if (key === "escape") return { st: st.q ? { ...st, q: "", y: 0 } : { ...st, typing: false }, close: false };
    if (key === "enter") return { st: { ...st, typing: false }, close: false };
    if (key === "backspace") return { st: { ...st, q: st.q.slice(0, -1), y: 0 }, close: false };
    if (mods.control && key === "u") return { st: { ...st, q: "", y: 0 }, close: false };
    if (key === "space") return { st: { ...st, q: st.q + " ", y: 0 }, close: false };
    if (!mods.control && !mods.platform && typeof key === "string" && [...key].length === 1) return { st: { ...st, q: st.q + key, y: 0 }, close: false };
    return { st, close: false };
  }
  if (key === "j" || key === "down") return at(st.y + 40);
  if (key === "k" || key === "up") return at(st.y - 40);
  if (mods.control && key === "d") return at(st.y + page / 2);
  if (mods.control && key === "u") return at(st.y - page / 2);
  if (key === "g" && !mods.shift) return at(0);
  if (key === "G" || (key === "g" && mods.shift)) return at(max);
  if (key === "/") return { st: { ...st, typing: true }, close: false };
  if (["shift", "control", "alt", "platform", "function"].includes(key)) return { st, close: false };
  return { st, close: true };
}

// The keys Herdr takes before this mod sees them: its "global" and "layout:*" sections, minus anything
// the mod's own "mod:<name>" section claims back. keysJson: keys.json as text or object.
export function takenKeys(keysJson, mod) {
  let k;
  try { k = typeof keysJson === "string" ? JSON.parse(keysJson) : keysJson; } catch { return new Map(); }
  const out = new Map();
  if (!k || typeof k !== "object") return out;
  for (const [sec, map] of Object.entries(k))
    if ((sec === "global" || sec.startsWith("layout:")) && map && typeof map === "object")
      for (const [key, action] of Object.entries(map)) out.set(key.toLowerCase(), typeof action === "string" ? action : action?.command ?? "");
  for (const key of Object.keys(k[`mod:${mod}`] ?? {})) out.delete(key.toLowerCase());
  return out;
}

// What Herdr does with a row's key instead, when it takes it (e.g. "pane.split"), or null.
export const takenBy = (row, taken) => (row?.[2]?.bind && taken?.get(row[2].bind.toLowerCase())) || null;
