import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handoff } from "../core/asks.js";
import { withHandoff, SYSTEM } from "../core/summary.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/asks.json", import.meta.url)));
for (const f of fixtures) {
  test(`handoff rule: ${f.name}`, () => assert.equal(Boolean(handoff(f.text)), f.expectMove));
}
test("the #218 sentence is what comes back", () => {
  assert.match(handoff("Docs and QA are working too, and #218 stays yours for when you're back at the keyboard."), /#218 stays yours/);
});
test("backstop fills your_move only when the model left it empty", () => {
  const t = "QA is running, and #218 is waiting for you.";
  assert.equal(withHandoff({ recap: "r", yourMove: null }, t, handoff).yourMove, "QA is running, and #218 is waiting for you.");
  assert.equal(withHandoff({ recap: "r", yourMove: "Run #218." }, t, handoff).yourMove, "Run #218.");
  assert.equal(withHandoff({ recap: "r", yourMove: null }, "All done.", handoff).yourMove, null);
});
test("the prompt tells the model hand-offs are asks", () => assert.match(SYSTEM, /waiting for you/));
