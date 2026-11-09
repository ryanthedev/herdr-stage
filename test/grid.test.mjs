import { test } from "node:test";
import assert from "node:assert/strict";
import { nextGrid, colsFor, rowOf, rowsFor } from "../core/grid.js";

test("grid: h/l move along the row and clamp at the ends", () => {
  assert.equal(nextGrid(1, "l", 5, 2).sel, 2);
  assert.equal(nextGrid(4, "l", 5, 2).sel, 4);
  assert.equal(nextGrid(0, "h", 5, 2).sel, 0);
  assert.equal(nextGrid(3, "ArrowLeft", 5, 2).sel, 2);
});

test("grid: j/k move a whole row", () => {
  assert.equal(nextGrid(0, "j", 6, 3).sel, 3);
  assert.equal(nextGrid(4, "k", 6, 3).sel, 1);
  assert.equal(nextGrid(1, "k", 6, 3).sel, 1);
  assert.equal(nextGrid(4, "j", 6, 3).sel, 4);
});

test("grid: j into a short last row lands on its last card", () => {
  // 3 columns, 5 cards: row 0 = 0 1 2, row 1 = 3 4. j from 2 goes to 4, not nowhere.
  assert.equal(nextGrid(2, "j", 5, 3).sel, 4);
  assert.equal(nextGrid(0, "j", 5, 3).sel, 3);
});

test("grid: with one column it behaves like the old list", () => {
  assert.equal(nextGrid(0, "j", 3, 1).sel, 1);
  assert.equal(nextGrid(2, "j", 3, 1).sel, 2);
  assert.equal(nextGrid(2, "k", 3, 1).sel, 1);
});

test("grid: g / G jump to the ends, enter opens, q closes", () => {
  assert.equal(nextGrid(2, "g", 5, 2).sel, 0);
  assert.equal(nextGrid(0, "G", 5, 2).sel, 4);
  assert.equal(nextGrid(0, "g", 5, 2, true).sel, 4);
  assert.deepEqual(nextGrid(1, "enter", 3, 2).effect, { open: 1 });
  assert.equal(nextGrid(0, "enter", 0, 2).effect, null);
  assert.deepEqual(nextGrid(1, "q", 3, 2).effect, { close: true });
});

test("grid: a selection past a shrunken list is pulled back", () => {
  assert.equal(nextGrid(7, "x", 3, 2).sel, 2);
});

test("grid: columns from width, rows from count", () => {
  assert.equal(colsFor(600, 260, 10, 16), 2);
  assert.equal(colsFor(200, 260, 10, 16), 1);
  assert.equal(colsFor(1000, 260, 10, 16), 3);
  assert.equal(rowOf(5, 2), 2);
  assert.equal(rowsFor(5, 2), 3);
  assert.equal(rowsFor(0, 2), 0);
});
