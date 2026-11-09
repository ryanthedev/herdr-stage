import { test } from "node:test";
import assert from "node:assert/strict";
import { parentsOf, families, spaceIdOf } from "../core/nest.js";

const spaces = [{ id: "A", name: "upublish" }, { id: "B", name: "cmd-data" }, { id: "C", name: "cmd-ui" }, { id: "D", name: "life" }];
const where = { t1: "B", t2: "C", t3: "A", t4: "D" };
const of = (t) => where[t.address];

test("parentsOf: by space name or id, from any terminal's label", () => {
  const terms = [{ address: "t1", labels: { "stage.parent": "upublish" } }, { address: "t2", labels: ["stage.parent=A"] }, { address: "t4", labels: {} }];
  assert.deepEqual(parentsOf(terms, spaces, of), { B: "A", C: "A" });
});

test("parentsOf: unknown parents, self and cycles are dropped", () => {
  const terms = [{ address: "t1", labels: { "stage.parent": "nope" } }, { address: "t3", labels: { "stage.parent": "upublish" } },
    { address: "t2", labels: { "stage.parent": "life" } }, { address: "t4", labels: { "stage.parent": "cmd-ui" } }];
  assert.deepEqual(parentsOf(terms, spaces, of), {});
});

test("families: children follow their parent; a high-ranked child lifts its family", () => {
  // Rank says D first, then C (a child of A), then A, then B (child of A).
  const out = families(["D", "C", "A", "B"], { B: "A", C: "A" });
  assert.deepEqual(out.map((e) => [e.id, e.depth]), [["D", 0], ["A", 0], ["C", 1], ["B", 1]]);
  assert.equal(out[1].kids, 2);
  // C ranked first: the whole A family goes first.
  assert.deepEqual(families(["C", "D", "A", "B"], { B: "A", C: "A" }).map((e) => e.id), ["A", "C", "B", "D"]);
});

test("remote terminals: their space gets the machine prefix back; names prefer the same machine", () => {
  assert.equal(spaceIdOf({ address: "vana/t9", labels: { "herdr.space": "spF" } }), "vana/spF");
  assert.equal(spaceIdOf({ address: "t2", labels: { "herdr.space": "spL" } }), "spL");
  assert.equal(spaceIdOf({ address: "vana/t9", labels: {} }, { "vana/t9": "vana/spF" }), "vana/spF");
  const spaces = [{ id: "spD", name: "devops" }, { id: "vana/spD", name: "devops" }, { id: "vana/spF", name: "SEC" }, { id: "spX", name: "x" }];
  const terms = [{ address: "vana/t9", labels: { "herdr.space": "spF", "stage.parent": "devops" } }, { address: "t1", labels: { "herdr.space": "spX", "stage.parent": "devops" } }];
  assert.deepEqual(parentsOf(terms, spaces, (t) => spaceIdOf(t)), { "vana/spF": "vana/spD", spX: "spD" });
});
