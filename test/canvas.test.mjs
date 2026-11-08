import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutCanvas, edgeSegments, nearest, camera, firstAgent, scaleLayout, fitZoom, detailAt, ZOOM, measure, wheelStep, awayOf } from "../core/canvas.js";
import { nextCanvas, next, zoomOf, wheelCanvas } from "../core/nav.js";

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

test("zoom: a scaled layout is the layout times z, and the camera keeps the selection in view", () => {
  const L = layoutCanvas(space), S = scaleLayout(L, 0.5);
  assert.equal(S.bbox.x1, L.bbox.x1 * 0.5); assert.equal(S.byId.qa.y, L.byId.qa.y * 0.5); assert.equal(S.byId.qa.h, L.byId.qa.h * 0.5);
  assert.equal(edgeSegments(S).length, edgeSegments(L).length);
  const cam = camera(S, "solo", 800, 400), n = S.byId.solo;
  assert.ok(cam.y + n.y >= 0 && cam.y + n.y + n.h <= 400, "zoomed selection is in view");
});
test("zoom: fit frames the tree, never above 1, never below the readable floor", () => {
  const L = layoutCanvas(space), w = L.bbox.x1, h = L.bbox.y1;
  assert.equal(fitZoom(L, 10000, 10000), 1, "a small tree stays at natural size");
  const z = fitZoom(L, w * 0.8 + 96, h * 2 + 96);
  assert.ok(Math.abs(z - 0.8) < 1e-9, `fits the width: ${z}`);
  assert.equal(fitZoom(L, 200, 200), ZOOM.autoMin);
});
test("zoom keys: + and - step from the fit zoom, clamp at the ends, 0 goes back to fit", () => {
  const L = layoutCanvas(space), view = { vw: 10000, vh: 10000 };
  let s = { sel: "solo", drawer: false };
  assert.equal(zoomOf(s, L, view), 1);
  s = nextCanvas(s, "=", L, view).state; assert.deepEqual([s.zoom, s.zoomSet], [1.15, true]);
  s = nextCanvas(s, "+", L, view).state; assert.equal(s.zoom, 1.3);
  for (let i = 0; i < 20; i++) s = nextCanvas(s, "-", L, view).state;
  assert.equal(s.zoom, ZOOM.min);
  for (let i = 0; i < 20; i++) s = nextCanvas(s, "=", L, view).state;
  assert.equal(s.zoom, ZOOM.max);
  s = nextCanvas(s, "0", L, view).state; assert.equal(s.zoomSet, false); assert.equal(zoomOf(s, L, view), 1);
  assert.equal(s.sel, "solo", "zoom never moves the selection");
  assert.equal(nextCanvas({ sel: "solo" }, "=", L, { ...view, fit: 0.6 }).state.zoom, 0.75, "steps from the fit the host shows");
});
test("semantic zoom and the theme key", () => {
  assert.deepEqual([0.4, 0.6, 1, 1.5].map(detailAt), ["name", "brief", "full", "full"]);
  const L = layoutCanvas(space);
  assert.deepEqual(nextCanvas({ sel: "solo" }, "t", L).effect, { theme: "toggle" });
  const vm = { cards: [{ id: "a", rows: [] }], lane: [] };
  assert.deepEqual(next({ zone: "cards", card: 0, lane: 0, row: 0 }, "t", vm).effect, { theme: "toggle" });
});
test("semantic zoom: zoomed-out cards are shorter, and nothing overlaps", () => {
  const full = layoutCanvas(space), name = layoutCanvas(space, "name");
  assert.ok(name.byId.solo.h < full.byId.solo.h && name.bbox.y1 < full.bbox.y1);
  assert.ok(name.byId.qa.h > name.byId.h1.h, "an ask keeps its room");
  const cards = name.nodes.filter((n) => n.kind === "agent");
  for (const a of cards) for (const b of cards) if (a !== b && a.x === b.x) assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y);
});
test("measured heights replace the estimate, push later cards down, and ignore jitter", () => {
  const est = layoutCanvas(space);
  let H = measure({}, "h1", 300);
  assert.deepEqual(H, { h1: 300 });
  assert.equal(measure(H, "h1", 301.5), null, "within tolerance: no re-layout");
  assert.equal(measure(H, "h1", 0), null, "an unlaid-out 0 is ignored");
  const L = layoutCanvas(space, "full", H);
  assert.equal(L.byId.h1.h, 300);
  assert.equal(L.byId.h2.y - est.byId.h2.y, 300 - est.byId.h1.h, "the next helper moves by the difference");
  const cards = L.nodes.filter((n) => n.kind === "agent");
  for (const a of cards) for (const b of cards) if (a !== b && a.x === b.x) assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y);
});
test("wheel: zoom keeps the point under the pointer still; pan moves the camera but not off the tree", () => {
  const L = layoutCanvas(space), view = { vw: 1600, vh: 900 }, cam = { x: 100, y: 50 };
  const p = { px: 700, py: 400 }, r = wheelStep(L, 1, cam, view, { dx: 0, dy: -50, zoom: true, ...p });
  assert.ok(r.z > 1, "natural scrolling: fingers up/away (content up, dy < 0) zooms in");
  const before = (p.px - cam.x) / 1, after = (p.px - r.cam.x) / r.z;
  assert.ok(Math.abs(before - after) < 1e-6, "same world x under the pointer");
  assert.equal(wheelStep(L, ZOOM.max, cam, view, { dx: 0, dy: -1e4, zoom: true, ...p }).z, ZOOM.max);
  assert.deepEqual(wheelStep(L, 1, cam, view, { dx: -30, dy: 20, ...p }).cam, { x: 70, y: 70 });
  const far = wheelStep(L, 1, cam, view, { dx: -1e5, dy: -1e5, ...p }).cam;
  assert.ok(far.x + L.bbox.x1 >= 120 && far.y + L.bbox.y1 >= 120, "some of the tree stays on screen");
});
test("wheel then keys: arrows and zoom keys hand the camera back to the selection, space keeps it", () => {
  const L = layoutCanvas(space), view = { vw: 1600, vh: 900 };
  let s = wheelCanvas({ sel: "solo", drawer: false, zoomSet: false }, { dx: 0, dy: -40, px: 800, py: 450, zoom: true }, L, view, { x: 0, y: 0 });
  assert.ok(s.zoomSet && s.zoom > 1 && s.cam);
  assert.ok(nextCanvas(s, " ", L, view).state.cam, "the drawer keeps the view");
  assert.equal(nextCanvas(s, "ArrowUp", L, view).state.cam, null);
  assert.equal(nextCanvas(s, "=", L, view).state.cam, null);
  const pan = wheelCanvas({ sel: "solo", zoomSet: false }, { dx: 10, dy: 0, px: 0, py: 0 }, L, { ...view, fit: 0.8 }, { x: 0, y: 0 });
  assert.equal(pan.zoomSet, false, "panning in fit mode stays fit");
});
test("wheel zoom direction follows the hand under both macOS scroll settings", () => {
  const L = layoutCanvas(space), view = { vw: 1600, vh: 900 }, cam = { x: 0, y: 0 }, at = { dx: 0, px: 800, py: 450, zoom: true };
  assert.equal(awayOf(-10), 10); assert.equal(awayOf(10, false), 10);
  assert.ok(wheelStep(L, 1, cam, view, { ...at, dy: -30 }).z > 1, "natural (default): away = dy < 0 = zoom in");
  assert.ok(wheelStep(L, 1, cam, view, { ...at, dy: 30 }).z < 1, "natural: toward = zoom out");
  assert.ok(wheelStep(L, 1, cam, view, { ...at, dy: 30, natural: false }).z > 1, "traditional: away = dy > 0 = zoom in");
  assert.deepEqual(wheelStep(L, 1, cam, view, { dx: 5, dy: 7, px: 0, py: 0, natural: false }).cam,
    wheelStep(L, 1, cam, view, { dx: 5, dy: 7, px: 0, py: 0 }).cam, "panning follows GPUI's delta either way");
});
