import { test } from "node:test";
import assert from "node:assert/strict";
import { tierFor, itemsOf, rowView, rowHeight, fitFor, previewOf, H } from "../core/rows.js";

const card = {
  rows: [{ addr: "t1", label: "idle one", state: "idle" }, { addr: "t2", label: "asker", state: "done", move: "pick A or B" }, { addr: "t3", label: "busy", state: "working" }],
  others: [{ kind: "shell", label: "zsh" }, { kind: "mod", label: "herdr-md" }],
};

test("tiers by width", () => {
  assert.deepEqual([1200, 900, 899, 640, 500, 420, 380, 300, 250].map(tierFor), ["xl", "xl", "l", "l", "m", "m", "s", "s", "xs"]);
});

test("items: asks, working, other agents, dashboards, processes, shells", () => {
  assert.deepEqual(itemsOf(card).map((i) => i.label), ["asker", "busy", "idle one", "herdr-md", "zsh"]);
});

test("rowView: wide tiers show what fits and count the rest; previews by tier", () => {
  const v = rowView(card, "xl", 3);
  assert.deepEqual(v.items.map((i) => i.label), ["asker", "busy", "idle one"]);
  assert.equal(v.more, 2);
  assert.equal(v.ask.label, "asker");
  assert.equal(v.preview({ kind: "shell" }), true);
  assert.equal(v.preview({ kind: "mod" }), false);
  assert.equal(rowView(card, "l", 3).preview({ kind: "shell" }), false);
  assert.equal(rowView(card, "l", 3).preview({ kind: "agent" }), true);
});

test("rowView: narrow tiers keep only the ask", () => {
  assert.deepEqual(rowView(card, "s", 9).items, []);
  assert.equal(rowView(card, "s", 9).ask.label, "asker");
  assert.equal(rowView(card, "xs", 9).ask, null);
  assert.equal(rowView({ rows: [], others: [] }, "s", 9).ask, null);
});

test("row heights: fixed in thumbnail tiers, taller with an ask in narrow ones", () => {
  assert.equal(rowHeight(card, "xl"), H.xl.row);
  assert.equal(rowHeight(card, "m"), H.m.ask);
  assert.equal(rowHeight({ rows: [], others: [] }, "m"), H.m.base);
  assert.equal(rowHeight(card, "s"), H.s.ask);
  assert.equal(rowHeight(card, "xs"), H.xs.base);
});

test("fit: thumbnails across after the name block", () => {
  assert.equal(fitFor("xl", 1280), 5);
  assert.equal(fitFor("l", 700), 3);
  assert.equal(fitFor("s", 380), 0);
});

test("previewOf: last non-empty lines, ANSI stripped, cut to width", () => {
  const scr = "a\nb\n\x1b[1mc\x1b[0m\n" + "x".repeat(60) + "\n\n\n";
  assert.deepEqual(previewOf(scr, 3, 10), ["b", "c", "xxxxxxxxx…"]);
});

test("previewOf: box-drawing rules are dropped", () => {
  assert.deepEqual(previewOf("hello\n──────\n❯\n│  │\n"), ["hello", "❯"]);
});
