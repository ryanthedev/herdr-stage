import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutCanvas, edgeSegments, nearest, camera, firstAgent } from "../core/canvas.js";
import { nextCanvas } from "../core/nav.js";

const ag = (o) => ({ pane: "p-" + o.addr, label: o.addr, state: "working", at: "2026-11-08T10:00:00Z", ...o });
const space = { id: "s", name: "upublish", agents: [
  ag({ addr: "lead", tab: "1", state: "done" }),
  ...["h1", "h2", "h3"].map((a) => ag({ addr: a, tab: "1", parent: "lead" })),
  ag({ addr: "qa", tab: "1", parent: "lead", state: "done", yourMove: "Approve the reset." }),
  ag({ addr: "solo", tab: "2", state: "idle" }),
] };

test("layout: tabs, lead and its helpers in their own column, no overlapping cards", () => {
  const L = layoutCanvas(space);
  assert.deepEqual(L.nodes.filter((n) => n.kind === "tab").map((n) => n.label), ["tab 1", "tab 2"]);
  assert.ok(L.byId.h1.x > L.byId.lead.x, "helpers sit right of the lead");
  const cards = L.nodes.filter((n) => n.kind === "agent");
  for (const a of cards) for (const b of cards) if (a !== b && a.x === b.x) assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} overlaps ${b.id}`);
  assert.ok(L.byId.solo.y > L.byId.qa.y, "tab 2 starts below tab 1's helpers");
  assert.equal(edgeSegments(L).length, L.edges.length * 3);
});
test("nav: up from tab 2's agent goes to the nearest box above, not the lead", () => {
  const L = layoutCanvas(space);
  assert.equal(nearest(L, "solo", "up"), "qa");
  assert.equal(nearest(L, "h2", "left"), "lead");
});
test("nav: Enter opens, Space toggles the drawer, Esc closes it then goes back, n finds the move", () => {
  const L = layoutCanvas(space); let s = { sel: "solo", drawer: false }, r;
  assert.deepEqual(nextCanvas(s, "Enter", L).effect, { open: "agent", pane: "p-solo", addr: "solo" });
  s = nextCanvas(s, " ", L).state; assert.equal(s.drawer, true);
  r = nextCanvas(s, "Escape", L); s = r.state; assert.equal(s.drawer, false); assert.equal(r.effect, null);
  assert.deepEqual(nextCanvas(s, "Escape", L).effect, { back: true });
  assert.equal(nextCanvas(s, "n", L).state.sel, "qa");
  assert.equal(firstAgent(L).id, "qa");
});
test("camera: centres a tree that fits, clamps one that doesn't", () => {
  const L = layoutCanvas(space);
  const fit = camera(L, "lead", 4000, 3000);
  assert.ok(fit.x > 0 && fit.y > 0);
  const tight = camera(L, "solo", 600, 300);
  assert.ok(tight.y + L.byId.solo.y >= 0 && tight.y + L.byId.solo.y + L.byId.solo.h <= 300, "selection is in view");
});
