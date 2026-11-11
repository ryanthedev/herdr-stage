import { test } from "node:test";
import assert from "node:assert/strict";
import { familyMarks } from "../core/nest.js";

const e = (id, depth = 0, parent = null) => ({ id, depth, parent });

test("familyMarks: a lone space is in no family", () => {
  assert.deepEqual(familyMarks([e("a")]), [{ fam: null, first: false, last: false, rails: [], elbow: -1 }]);
});

test("familyMarks: root and two kids share one family; the rail runs past the first kid only", () => {
  const m = familyMarks([e("up"), e("c1", 1, "up"), e("c2", 1, "up"), e("x")]);
  assert.deepEqual(m.map((r) => r.fam), ["up", "up", "up", null]);
  assert.deepEqual(m.map((r) => [r.first, r.last]), [[true, false], [false, false], [false, true], [false, false]]);
  assert.deepEqual(m[0].rails, [0]);       // root: its rail runs down from its header
  assert.deepEqual(m[1].rails, [0]);       // first kid: c2 still hangs off level 0
  assert.deepEqual(m[2].rails, []);        // last kid: the rail stops at its elbow
  assert.deepEqual(m.map((r) => r.elbow), [-1, 0, 0, -1]);
});

test("familyMarks: a grandchild keeps its grandparent's rail running when an uncle follows", () => {
  const m = familyMarks([e("r"), e("a", 1, "r"), e("a1", 2, "a"), e("b", 1, "r")]);
  assert.deepEqual(m[1].rails, [0, 1]);    // a: level 0 continues to b; level 1 continues to a1
  assert.deepEqual(m[2].rails, [0]);       // a1: only level 0 continues (to b)
  assert.deepEqual(m[2].elbow, 1);
  assert.deepEqual(m[3].rails, []);
});

test("familyMarks: a kid whose parent isn't listed (filtered away) is on its own", () => {
  assert.equal(familyMarks([e("c", 1, "gone")])[0].fam, null);
});
