import { test } from "node:test";
import assert from "node:assert/strict";
import { nextList } from "../core/list.js";

test("list: j/k move and clamp at both ends", () => {
  assert.equal(nextList(0, "j", 3).sel, 1);
  assert.equal(nextList(2, "down", 3).sel, 2);
  assert.equal(nextList(0, "k", 3).sel, 0);
  assert.equal(nextList(2, "ArrowUp", 3).sel, 1);
});

test("list: g / G jump to the ends", () => {
  assert.equal(nextList(2, "g", 5).sel, 0);
  assert.equal(nextList(0, "G", 5).sel, 4);
  assert.equal(nextList(0, "g", 5, true).sel, 4);
});

test("list: enter opens the selected space, q closes", () => {
  assert.deepEqual(nextList(1, "enter", 3).effect, { open: 1 });
  assert.equal(nextList(0, "enter", 0).effect, null);
  assert.deepEqual(nextList(1, "q", 3).effect, { close: true });
});

test("list: a selection past a shrunken list is pulled back", () => {
  assert.equal(nextList(7, "x", 3).sel, 2);
});
