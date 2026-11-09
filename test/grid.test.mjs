import { test } from "node:test";
import assert from "node:assert/strict";
import { nextGrid, colsFor, layoutRows, rowOf } from "../core/grid.js";

const flat = (n, cols) => layoutRows(Array(n).fill(0).map((_, i) => (i ? 1 : 0)), cols); // one family: plain grid

test("rows: a plain list fills rows of cols", () => {
  assert.deepEqual(flat(5, 2), [[0, 1], [2, 3], [4]]);
});

test("rows: every top-level space starts a new row; its children follow it", () => {
  // A(0) a1(1) a2(1) B(0) C(0) c1(1)
  assert.deepEqual(layoutRows([0, 1, 1, 0, 0, 1], 2), [[0, 1], [2], [3], [4, 5]]);
  assert.deepEqual(layoutRows([0, 0, 0], 3), [[0], [1], [2]]);
});

test("grid: h/l step through cards in order and clamp", () => {
  const rows = flat(5, 2);
  assert.equal(nextGrid(1, "l", rows).sel, 2);
  assert.equal(nextGrid(4, "l", rows).sel, 4);
  assert.equal(nextGrid(0, "h", rows).sel, 0);
});

test("grid: j/k keep the column, landing on a short row's last card", () => {
  const rows = flat(5, 3); // [0 1 2] [3 4]
  assert.equal(nextGrid(0, "j", rows).sel, 3);
  assert.equal(nextGrid(2, "j", rows).sel, 4);
  assert.equal(nextGrid(4, "k", rows).sel, 1);
  assert.equal(nextGrid(4, "j", rows).sel, 4);
  assert.equal(nextGrid(1, "k", rows).sel, 1);
});

test("grid: j/k across family rows", () => {
  const rows = layoutRows([0, 1, 1, 0, 0, 1], 2); // [0 1] [2] [3] [4 5]
  assert.equal(nextGrid(1, "j", rows).sel, 2);
  assert.equal(nextGrid(2, "j", rows).sel, 3);
  assert.equal(nextGrid(3, "j", rows).sel, 4);
  assert.equal(nextGrid(5, "k", rows).sel, 3);
});

test("grid: g / G, enter, q, and a shrunken list", () => {
  const rows = flat(5, 2);
  assert.equal(nextGrid(2, "g", rows).sel, 0);
  assert.equal(nextGrid(0, "G", rows).sel, 4);
  assert.equal(nextGrid(0, "g", rows, true).sel, 4);
  assert.deepEqual(nextGrid(1, "enter", rows).effect, { open: 1 });
  assert.equal(nextGrid(0, "enter", []).effect, null);
  assert.deepEqual(nextGrid(1, "q", rows).effect, { close: true });
  assert.equal(nextGrid(7, "x", flat(3, 2)).sel, 2);
});

test("grid: columns from width, row of a card", () => {
  assert.equal(colsFor(600, 260, 10, 16), 2);
  assert.equal(colsFor(200, 260, 10, 16), 1);
  assert.equal(rowOf(3, [[0, 1], [2], [3]]), 2);
});
