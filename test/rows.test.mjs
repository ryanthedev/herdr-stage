import { test } from "node:test";
import assert from "node:assert/strict";
import { tierFor, itemsOf, rowView, rowHeight, fitFor, slotW, statusOf, ROW } from "../core/rows.js";

const card = {
  counts: { move: 1, working: 1 },
  rows: [{ addr: "t1", label: "idle one", state: "idle" }, { addr: "t2", label: "asker", state: "done", move: "pick A or B" }, { addr: "t3", label: "busy", state: "working" }],
  others: [{ kind: "shell", label: "zsh" }, { kind: "mod", label: "herdr-md" }],
};
const empty = { counts: {}, rows: [], others: [] };

test("tiers by width", () => {
  assert.deepEqual([1200, 420, 419, 300, 299].map(tierFor), ["wide", "wide", "s", "s", "xs"]);
});

test("items: asks, working, other agents, dashboards, processes, shells", () => {
  assert.deepEqual(itemsOf(card).map((i) => i.label), ["asker", "busy", "idle one", "herdr-md", "zsh"]);
});

test("bubbles: as many as fit, the rest counted; one when narrow; none when tiny", () => {
  assert.equal(fitFor("wide", 1200), 4);
  assert.equal(fitFor("wide", 640), 2);
  assert.equal(fitFor("wide", 500), 1);
  const v = rowView(card, "wide", 640);
  assert.deepEqual(v.bubbles.map((i) => i.label), ["asker", "busy"]);
  assert.equal(v.more, 3);
  assert.deepEqual(rowView(card, "s", 350).bubbles.map((i) => i.label), ["asker"]);
  assert.deepEqual(rowView(card, "xs", 250).bubbles, []);
});

test("row heights: a bubble row, a header-only row, the tiny row", () => {
  assert.equal(rowHeight(card, "wide"), ROW.padY * 2 + ROW.head + ROW.meta + ROW.gap + ROW.bubble);
  assert.equal(rowHeight(empty, "wide"), ROW.padY * 2 + ROW.head + ROW.meta);
  assert.equal(rowHeight(card, "xs"), ROW.xs);
});

test("status word, most urgent first", () => {
  assert.equal(statusOf(card), "needs you");
  assert.equal(statusOf({ counts: { working: 1 }, rows: [{ state: "working" }] }), "working");
  assert.equal(statusOf(empty, "done"), "done");
  assert.equal(statusOf({ counts: {}, rows: [], others: [{ kind: "shell" }] }), "idle");
  assert.equal(statusOf(empty), "empty");
});

test("slots: bubbles split the row evenly and fill it", () => {
  const w = 1000, n = fitFor("wide", w), s = slotW("wide", w);
  assert.equal(n, 3);
  assert.ok(s >= 280 && n * s + 8 * (n - 1) <= w - 32 && n * s + 8 * (n - 1) > w - 32 - n);
  assert.equal(slotW("s", 350), 350 - 32);
});
