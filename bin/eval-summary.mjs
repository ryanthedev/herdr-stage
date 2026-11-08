#!/usr/bin/env node
// eval-summary: run the asks fixtures through the real summarizer (one small model call each) and
// report whether the model alone, and the model plus the rule backstop, find the ask. Not a unit test:
// it spends model quota, so run it by hand after changing the prompt.
import { readFileSync } from "node:fs";
import { buildPrompt, parseSummary, withHandoff, SYSTEM } from "../core/summary.js";
import { handoff } from "../core/asks.js";
import { makeSummarizer } from "../adapters/node.js";

const fx = JSON.parse(readFileSync(new URL("../test/fixtures/asks.json", import.meta.url)));
const only = process.argv.includes("--first") ? fx.slice(0, 1) : fx;
const summarize = makeSummarizer({ system: SYSTEM });
let pass = 0;
for (const f of only) {
  const s = parseSummary((await summarize(buildPrompt({ space: "fixture", title: f.name, text: f.text }))).text);
  const both = withHandoff(s, f.text, handoff);
  const ok = Boolean(both.yourMove) === f.expectMove; pass += ok;
  console.log(`${ok ? "PASS" : "FAIL"}  ${f.name}\n      model: ${s.yourMove ?? "null"}\n      final: ${both.yourMove ?? "null"}`);
}
console.log(`${pass}/${only.length} pass`);
