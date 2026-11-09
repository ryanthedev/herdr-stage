import { test } from "node:test";
import assert from "node:assert/strict";
import { track, prune, scoreOf, rank, HALF_LIFE_H } from "../core/order.js";

const H = 3600000, NOW = 1_800_000_000_000;

test("track: time in a space adds dwell, a switch adds a visit", () => {
  let s = track({}, "a", NOW);
  assert.equal(s.a.visits, 1);
  s = track(s, "a", NOW + 10000);
  assert.ok(Math.abs(s.a.dwell - 10000 / 60000) < 1e-3);
  s = track(s, "b", NOW + 20000);
  assert.equal(s.b.visits, 1);
  assert.equal(s._active, "b");
});

test("track: a long gap (pane closed, asleep) is not counted as dwell", () => {
  let s = track({}, "a", NOW);
  s = track(s, "a", NOW + 2 * H);
  assert.ok(s.a.dwell <= 0.5 + 1e-9);
});

test("track: counts decay with the half-life", () => {
  let s = track({}, "a", NOW);
  s = track(s, null, NOW + HALF_LIFE_H * H);
  assert.ok(Math.abs(s.a.visits - 0.5) < 1e-9);
});

test("prune drops spaces that are gone", () => {
  assert.deepEqual(Object.keys(prune({ a: {}, b: {}, _at: 1 }, ["a"])).sort(), ["_at", "a"]);
});

test("score: recent activity counts even with no presence", () => {
  assert.ok(scoreOf(null, NOW, NOW) > scoreOf(null, NOW - 48 * H, NOW));
  assert.equal(scoreOf(null, null, NOW), 0);
});

test("rank: urgent first, then score, ties keep the sidebar order", () => {
  const store = { b: { dwell: 100, visits: 3, last: NOW - H }, c: { dwell: 5, visits: 1, last: NOW - H } };
  const items = [{ id: "a", urgent: false }, { id: "b", urgent: false }, { id: "c", urgent: true }, { id: "d", urgent: false }];
  assert.deepEqual(rank(items, store, NOW), ["c", "b", "a", "d"]);
});
