import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY, MAX, visit, step, recent, ago } from "../core/history.js";

const go = (ids) => ids.reduce((h, id, i) => visit(h, id, i * 1000), EMPTY);

test("visit: appends each switch; staying put adds nothing", () => {
  const h = go(["a", "b", "b", "c"]);
  assert.deepEqual(h.log.map((e) => e.id), ["a", "b", "c"]);
  assert.equal(h.pos, 2);
  assert.equal(visit(h, null, 9), h);
});

test("step: back and forward move pos without adding entries", () => {
  let h = go(["a", "b", "c"]);
  let r = step(h, -1); assert.equal(r.target, "b"); h = r.h;
  assert.equal(visit(h, "b", 99), h);                 // landing on b is not a new visit
  r = step(h, -1); assert.equal(r.target, "a"); h = r.h;
  r = step(h, 1); assert.equal(r.target, "b"); h = r.h;
  r = step(h, 1); assert.equal(r.target, "c"); h = r.h;
  assert.equal(step(h, 1).target, null);              // nothing ahead
  assert.equal(h.log.length, 3);
});

test("step: skips closed spaces and the space you're in", () => {
  const h = go(["a", "x", "b", "a"]);                  // pos on the last a
  assert.equal(step(h, -1, (id) => id !== "x").target, "b");
  const r = step(h, -1, (id) => id !== "b");          // b closed: skip it and x? x exists
  assert.equal(r.target, "x");
  assert.equal(step(go(["a", "a"]), -1).target, null);
});

test("visit after going back keeps the whole record and jumps to the end", () => {
  let h = go(["a", "b", "c"]);
  h = step(h, -1).h;                                  // on b
  h = visit(h, "d", 50);
  assert.deepEqual(h.log.map((e) => e.id), ["a", "b", "c", "d"]);
  assert.equal(h.pos, 3);
  assert.equal(step(h, -1).target, "c");
});

test("visit caps the log at MAX", () => {
  const h = go(Array.from({ length: MAX + 5 }, (_, i) => `s${i % 3}`));
  assert.equal(h.log.length, MAX);
  assert.equal(h.pos, MAX - 1);
});

test("recent: each space once, newest first, with visit counts", () => {
  const h = go(["a", "b", "a", "c", "a"]);
  assert.deepEqual(recent(h).map((r) => [r.id, r.visits]), [["a", 3], ["c", 1], ["b", 1]]);
  assert.deepEqual(recent(h, (id) => id !== "c").map((r) => r.id), ["a", "b"]);
  assert.deepEqual(recent(null), []);
});

test("ago: short labels", () => {
  assert.equal(ago(0, 10_000), "now");
  assert.equal(ago(0, 5 * 60_000), "5m");
  assert.equal(ago(0, 3 * 3600_000), "3h");
  assert.equal(ago(0, 2 * 86400_000), "2d");
});
