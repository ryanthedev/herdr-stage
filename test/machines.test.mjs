import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL, HERE, machineTabs, onTab, nextTab, onlyTab } from "../core/machines.js";

const sp = (id, machine = null) => ({ id, name: id, machine });

test("tabs: All, this computer, then machines by name", () => {
  assert.deepEqual(machineTabs([sp("a", "vana"), sp("b"), sp("c", "ska"), sp("d", "ska")]), [ALL, HERE, "ska", "vana"]);
});

test("tabs: no this-computer tab when it has no spaces", () => {
  assert.deepEqual(machineTabs([sp("a", "vana"), sp("c", "ska")]), [ALL, "ska", "vana"]);
});

test("tabs: none when every space is on one machine", () => {
  assert.deepEqual(machineTabs([sp("a"), sp("b")]), []);
  assert.deepEqual(machineTabs([sp("a", "ska")]), []);
  assert.deepEqual(machineTabs([]), []);
});

test("onTab: All takes everything; this computer is machine null", () => {
  assert.equal(onTab(ALL, sp("a", "ska")), true);
  assert.equal(onTab(HERE, sp("a")), true);
  assert.equal(onTab(HERE, sp("a", "ska")), false);
  assert.equal(onTab("ska", sp("a", "ska")), true);
  assert.equal(onTab("ska", sp("a", "vana")), false);
});

test("nextTab: wraps both ways; an unknown tab starts at All", () => {
  const tabs = [ALL, HERE, "ska"];
  assert.equal(nextTab(tabs, ALL, 1), HERE);
  assert.equal(nextTab(tabs, "ska", 1), ALL);
  assert.equal(nextTab(tabs, ALL, -1), "ska");
  assert.equal(nextTab(tabs, "gone", 1), ALL);
  assert.equal(nextTab([], "ska", 1), ALL);
});

test("onlyTab: keeps the tab's spaces; an orphaned child moves to the top level", () => {
  const e = (id, machine, parent = null) => ({ id, depth: parent ? 1 : 0, parent, kids: 0, space: sp(id, machine) });
  const entries = [e("devops", "vana"), e("sec", "vana", "devops"), e("x", "ska", "devops"), e("local", null)];
  assert.deepEqual(onlyTab(entries, "vana").map((x) => [x.id, x.depth]), [["devops", 0], ["sec", 1]]);
  assert.deepEqual(onlyTab(entries, "ska").map((x) => [x.id, x.depth, x.parent]), [["x", 0, null]]);
  assert.equal(onlyTab(entries, ALL), entries);
});
