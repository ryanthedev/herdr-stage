import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStage } from "../core/stage.js";
import { next, initial } from "../core/nav.js";
import { extractAsk } from "../core/asks.js";
import { lastAssistantText, transcriptRel } from "../core/transcript.js";

const ag = (o) => ({ addr: "t1", pane: "p1", tab: "1", label: "a", state: "done", at: "2026-11-08T10:00:00Z", ...o });
const input = { spaces: [
  { id: "s1", name: "upublish", folder: "/Users/r/repos/upublish", git: { branch: "main", worktrees: 3, branches: 9 },
    agents: [ag({ addr: "t1", pane: "p1", state: "working", msg: "building" }), ag({ addr: "t2", pane: "p2", yourMove: "Run #218." }), ag({ addr: "t3", pane: "p3", state: "idle" }), ag({ addr: "t4", pane: "p4" })] },
  { id: "s2", name: "demo", folder: "/tmp/x", git: null, agents: [] },
  { id: "s3", name: "life", folder: "/Users/r/repos/life", git: { branch: "main", worktrees: 1, branches: 1 }, agents: [ag({ addr: "t9", pane: "p9", state: "blocked", msg: "Allow rm?" })] },
] };

test("cards: repo spaces first, counts, facts, top rows with the move first", () => {
  const vm = buildStage(input);
  assert.deepEqual(vm.cards.map((c) => c.name), ["upublish", "life", "demo"]);
  const u = vm.cards[0];
  assert.deepEqual(u.counts, { move: 1, working: 1, idle: 2 });
  assert.deepEqual(u.facts, ["~/repos/upublish", "⎇ main", "3 worktrees", "9 branches"]);
  assert.equal(u.top[0].addr, "t2"); assert.equal(u.more, 1);
  assert.equal(vm.cards[2].loose, true);
});
test("lane: blocked outranks a model ask", () => {
  const vm = buildStage(input);
  assert.deepEqual(vm.lane.map((m) => m.addr), ["t9", "t2"]);
});
test("nav: lane -> cards -> step into a card -> open an agent", () => {
  const vm = buildStage(input); let st = initial(vm), r;
  assert.equal(st.zone, "lane");
  r = next(st, "ArrowDown", vm, 2); st = r.state; assert.equal(st.zone, "cards");
  r = next(st, " ", vm, 2); st = r.state; assert.equal(st.zone, "agents");
  r = next(st, "ArrowDown", vm, 2); st = r.state; assert.equal(st.row, 1);
  r = next(st, "Enter", vm, 2); assert.deepEqual(r.effect, { open: "agent", space: "s1", pane: vm.cards[0].rows[1].pane });
});
test("nav: grid moves by columns and Enter opens the space; Esc closes", () => {
  const vm = buildStage(input); let st = { ...initial(vm), zone: "cards" };
  st = next(st, "ArrowRight", vm, 2).state; assert.equal(st.card, 1);
  st = next(st, "ArrowDown", vm, 2).state; assert.equal(st.card, 1, "no card below in a 2-col grid of 3 at index 1");
  st = next(st, "ArrowLeft", vm, 2).state; st = next(st, "ArrowDown", vm, 2).state; assert.equal(st.card, 2);
  assert.deepEqual(next(st, "Enter", vm, 2).effect, { open: "space", space: "s2" });
  assert.deepEqual(next(st, "Escape", vm, 2).effect, { close: true });
});
test("extractAsk: the bold line, options under a colon, else the last question", () => {
  assert.equal(extractAsk("Done.\n\n**What you need to do:** run `x`.").ask, "run x.");
  assert.equal(extractAsk("**What you need to do:** pick one:\n- Close them\n- Show them").ask, "pick one: Close them / Show them");
  assert.deepEqual(extractAsk("Merged.\nDoes this capture what you want?"), { ask: null, question: "Does this capture what you want?" });
});
test("transcript: last assistant text from a tail that starts mid-line", () => {
  const tail = 'ial line"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"first"}]}}\n{"type":"user"}\n{"type":"assistant","timestamp":"T","message":{"content":[{"type":"tool_use"},{"type":"text","text":"last"}]}}\n';
  assert.deepEqual(lastAssistantText(tail), { text: "last", at: "T" });
  assert.equal(transcriptRel("abc", "/Users/r/.config"), ".claude/projects/-Users-r--config/abc.jsonl");
});
