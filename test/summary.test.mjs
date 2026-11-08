import { test } from "node:test";
import assert from "node:assert/strict";
import { needsSummary, buildPrompt, parseSummary } from "../core/summary.js";

const a = { addr: "t1", state: "done", text: "Finished. **What you need to do:** run it.", at: "2026-11-08T10:00:00Z" };
test("summarizes a done agent once per message", () => {
  assert.equal(needsSummary(a, undefined), true);
  assert.equal(needsSummary(a, { at: a.at }), false);
  assert.equal(needsSummary(a, { at: "2026-11-08T09:00:00Z" }), true);
});
test("skips working agents unless forced", () => {
  assert.equal(needsSummary({ ...a, state: "working" }, undefined), false);
  assert.equal(needsSummary({ ...a, state: "working" }, undefined, { force: true }), true);
});
test("skips agents with no message", () => assert.equal(needsSummary({ ...a, text: null }, undefined), false));
test("prompt keeps the tail of long messages", () => {
  const p = buildPrompt({ space: "s", title: "t", text: "x".repeat(10000) + "ASK" }, 100);
  assert.ok(p.includes("ASK") && p.length < 300);
});
test("parses fenced JSON and normalizes empty moves", () => {
  assert.deepEqual(parseSummary('```json\n{"recap":"Built it.","your_move":null}\n```'), { recap: "Built it.", yourMove: null });
  assert.deepEqual(parseSummary('{"recap":"Built.","your_move":"None"}'), { recap: "Built.", yourMove: null });
  assert.equal(parseSummary('{"recap":"Built.","your_move":"Test the pane."}').yourMove, "Test the pane.");
});
test("rejects replies without a recap", () => assert.throws(() => parseSummary('{"your_move":null}')));
