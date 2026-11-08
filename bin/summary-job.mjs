#!/usr/bin/env node
// summary-job: summarize Claude agents when they go idle, into ~/.cache/herdr-stage/summaries.json.
//   summary-job            watch: look every 5 s, summarize agents whose newest message isn't summarized yet
//   summary-job --once     one pass, then exit
//   summary-job --addr t2r summarize that agent now, whatever its state (the "focus" / `s` path)
import { needsSummary, buildPrompt, parseSummary, record, withHandoff, SYSTEM } from "../core/summary.js";
import { handoff } from "../core/asks.js";
import { listAgents, makeSummarizer, fileStore } from "../adapters/node.js";

const args = process.argv.slice(2);
const once = args.includes("--once"), addr = args.includes("--addr") ? args[args.indexOf("--addr") + 1] : null;
const store = fileStore(), summarize = makeSummarizer({ system: SYSTEM });
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

async function pass() {
  const all = store.read();
  const agents = (await listAgents()).filter((a) => !addr || a.addr === addr);
  const due = agents.filter((a) => needsSummary(a, all[a.addr], { force: Boolean(addr) }));
  for (let i = 0; i < due.length; i += 2) {           // two at a time: fast, and gentle on quota
    await Promise.all(due.slice(i, i + 2).map(async (a) => {
      try {
        const r = await summarize(buildPrompt(a));
        const s = withHandoff(parseSummary(r.text), a.text, handoff);
        all[a.addr] = record(a, s, { model: r.model, cost: r.cost });
        store.write(all);
        log(a.addr, a.space, "|", s.recap, s.yourMove ? `| YOUR MOVE: ${s.yourMove}` : "");
      } catch (e) { log(a.addr, "failed:", e.message); }
    }));
  }
  return due.length;
}

if (once || addr) { const n = await pass(); log(`done, ${n} summarized`); }
else for (;;) { await pass().catch((e) => log("pass failed:", e.message)); await new Promise((r) => setTimeout(r, 5000)); }
