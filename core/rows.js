// One space per row, adapting to the pane's width. Pure: the skin asks which tier it is in, which items a
// row shows, and how tall the row is (the virtual list needs heights up front; it can't measure).
//
// Tiers, widest first. Each drops detail in priority order:
//   xl  >= 900  name block on the left, items as thumbnails with a preview of their screen
//   l   >= 640  smaller thumbnails; only agents keep a preview
//   m   >= 420  name block on top, items as one line of chips; asks keep their text
//   s   >= 300  one line per space, plus its most urgent ask
//   xs  <  300  name and what needs you
export const TIERS = [["xl", 900], ["l", 640], ["m", 420], ["s", 300], ["xs", 0]];
export const tierFor = (width) => TIERS.find(([, min]) => width >= min)[0];

// Row heights per tier (px, before the app's zoom). Kept here so the skin and tests agree.
export const H = {
  xl: { row: 142 },
  l: { row: 122 },
  m: { base: 106, ask: 134 },
  s: { base: 38, ask: 58 },
  xs: { base: 36 },
};
export const ROW_GAP = 6;

// The items of a space in the order they matter: asks, working agents, other agents, dashboards,
// processes, shells. card: the view-model card (rows = agents, others = non-agent panes).
export function itemsOf(card) {
  const agents = (card?.rows ?? []).map((r) => ({ kind: "agent", ...r, rank: r.move ? 0 : r.state === "working" ? 1 : 2 }));
  const KIND = { mod: 3, process: 4, shell: 5 };
  const others = (card?.others ?? []).map((o) => ({ ...o, rank: KIND[o.kind] ?? 5 }));
  return [...agents, ...others].sort((a, b) => a.rank - b.rank);
}

// What a row shows at a tier: { items, more, preview: (item) => bool, askLine } where `more` counts
// items left out. `fit` is how many items fit across (from the width, for xl/l/m).
export function rowView(card, tier, fit) {
  const all = itemsOf(card), ask = all.find((i) => i.move);
  if (tier === "s" || tier === "xs") return { items: [], more: 0, ask: tier === "s" ? ask ?? null : null };
  const n = Math.max(1, fit), items = all.slice(0, n);
  return { items, more: all.length - items.length, ask: ask ?? null,
    preview: (i) => tier === "xl" ? i.kind !== "mod" : tier === "l" ? i.kind === "agent" : false };
}

export function rowHeight(card, tier) {
  const ask = itemsOf(card).some((i) => i.move);
  const h = H[tier];
  return h.row ?? (ask && h.ask ? h.ask : h.base);
}

// How many items fit across a row: thumbnails (xl/l) or chips (m), after the name block.
export const THUMB_W = { xl: 168, l: 136 };
export const META_W = { xl: 220, l: 186 };
export function fitFor(tier, width) {
  if (tier === "xl" || tier === "l") return Math.max(1, Math.floor((width - META_W[tier] - 40 + 8) / (THUMB_W[tier] + 8)));
  if (tier === "m") return Math.max(1, Math.floor((width - 40) / 130));
  return 0;
}

// The last few non-empty lines of a terminal screen, for a thumbnail. Trailing blank lines (the empty
// screen below the prompt) are dropped; each line is cut to `cols` characters.
export function previewOf(screen, lines = 6, cols = 46) {
  const all = String(screen ?? "").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  // Rules and frames (lines of only box-drawing characters) carry nothing at thumbnail size.
  const kept = all.filter((l) => !/^[\s─━│┃═╭╮╰╯┌┐└┘├┤┬┴┼-]+$/.test(l) || !l.trim());
  all.length = 0; all.push(...kept);
  while (all.length && !all[all.length - 1]) all.pop();
  return all.slice(-lines).map((l) => (l.length > cols ? l.slice(0, cols - 1) + "…" : l));
}
