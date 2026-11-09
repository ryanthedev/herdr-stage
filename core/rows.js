// One space per row, in the Heel overview's anatomy: a header line (name + status word), a quiet mono meta
// line, then a sliding window of message bubbles, one per item, needs-you first. Pure: the skin asks which
// tier it is in, which bubbles a row shows, and how tall the row is (the virtual list can't measure).
//
// Tiers, widest first. Each drops detail in priority order:
//   wide >= 420  bubbles side by side, as many as fit, then "+N"
//   s    >= 300  one bubble: the most important item
//   xs   <  300  the header line only
export const TIERS = [["wide", 420], ["s", 300], ["xs", 0]];
export const tierFor = (width) => TIERS.find(([, min]) => width >= min)[0];

// Row geometry (px, before the app's zoom), shared by the skin and tests.
export const ROW = { padY: 12, head: 22, meta: 16, gap: 8, bubble: 96, xs: 40 }; // bubble: title + 3 message lines
export const BUBBLE_GAP = 8, SIDE = 16;
export const bubbleW = (width) => (width >= 900 ? 260 : 224);

// The items of a space in the order they matter: asks, working agents, other agents, dashboards,
// processes, shells. card: the view-model card (rows = agents, others = non-agent panes).
export function itemsOf(card) {
  const agents = (card?.rows ?? []).map((r) => ({ kind: "agent", ...r, rank: r.move ? 0 : r.state === "working" ? 1 : 2 }));
  const KIND = { mod: 3, process: 4, shell: 5 };
  const others = (card?.others ?? []).map((o) => ({ ...o, rank: KIND[o.kind] ?? 5 }));
  return [...agents, ...others].sort((a, b) => a.rank - b.rank);
}

// How many bubbles fit across a row at this width.
export function fitFor(tier, width) {
  if (tier === "s") return 1;
  if (tier !== "wide") return 0;
  return Math.max(1, Math.floor((width - 2 * SIDE + BUBBLE_GAP) / (bubbleW(width) + BUBBLE_GAP)));
}

// What a row shows: { bubbles, more } — `more` counts the items left out.
export function rowView(card, tier, width) {
  const all = itemsOf(card), n = fitFor(tier, width);
  const bubbles = all.slice(0, n);
  return { bubbles, more: all.length - bubbles.length };
}

export function rowHeight(card, tier) {
  if (tier === "xs") return ROW.xs;
  const base = ROW.padY * 2 + ROW.head + ROW.meta;
  return itemsOf(card).length ? base + ROW.gap + ROW.bubble : base;
}

// The status word a row's header carries, most urgent first.
export function statusOf(card, liveStatus) {
  if (card?.counts.move || liveStatus === "blocked") return "needs you";
  if (card?.counts.working || liveStatus === "working") return "working";
  if (liveStatus === "done") return "done";
  return itemsOf(card).length ? "idle" : "empty";
}
