// Skin tokens: the only place colours and fonts live. "default" follows the Herdr theme with an orange
// your-move; "noir" is the POC's neon noir (~/.design-loop/herdr/r2/poc.html, body[data-theme="noir"]).
// GPUI has no letter-spacing, text glow or coloured shadows, so noir trades them for uppercase headings in a
// condensed face, heavier weight, tinted selection bands and neon borders.
export const THEMES = ["default", "noir"];

export function tokens(t, name) {
  if (name === "noir") return {
    name, bg: "#05070a", bar: "#05070a", card: "#0b1014", card2: "#101820", popover: "#070b0e", inset: "#0b1014",
    border: "#16323b", line: "#1d3a44", edge: "#1f5560", loose: "#2a3a40",
    ink: "#f3e6d3", ink2: "#cbb9a1", muted: "#7f8a8f", section: "#6f8a90", tabInk: "#6fa9b3",
    head: "#ffe2bf", crumb: "#ffcf99", headWeight: 700, caps: true,
    sans: "Avenir Next", display: "Avenir Next Condensed",
    focus: "#05d9e8", selBg: "#05d9e814", working: "#ffb000", done: "#05d9e8", idle: "#5a6a70", blocked: "#ff5c47",
    move: "#ff2a6d", moveInk: "#ffc2d4", moveBg: "#1a0612", moveLine: "#5c1532", moveMeta: "#e0789a", moveRow: "#ff6f9a", onMove: "#14000a",
    kbd: "#9fd8e0", shadow: true,
  };
  return {
    name: "default", bg: t.background, bar: t.background, card: t.raised ?? "#1a1d23", card2: t.raised ?? "#1a1d23",
    popover: t.popover, inset: t.background,
    border: t.border, line: t.border, edge: t.border, loose: t.border,
    ink: t.foreground, ink2: t.foreground, muted: t.muted, section: t.muted, tabInk: t.muted,
    head: t.foreground, crumb: t.foreground, headWeight: 600, caps: false,
    sans: null, display: "New York",
    focus: t.accent, selBg: t.selected, working: t.working, done: t.done, idle: t.idle ?? t.dim ?? t.muted, blocked: t.blocked,
    move: "#ff9f43", moveInk: "#ffe2c2", moveBg: "#22170c", moveLine: "#5a3a19", moveMeta: "#c69a6c", moveRow: "#ff9f43", onMove: "#000000",
    kbd: t.muted, shadow: false,
  };
}
