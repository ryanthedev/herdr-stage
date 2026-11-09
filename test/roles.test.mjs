import { test } from "node:test";
import assert from "node:assert/strict";
import { rolesOf, labelsOf } from "../core/roles.js";

const terms = [
  { address: "t5d", labels: { role: "proxy" } },
  { address: "t5s", labels: ["role=orchestrator"] },
  { address: "t6j", labels: {} },
  { address: "t9", labels: { role: "orchestrator" } }, // not in any space: ignored
];
const agents = [
  { address: "t5d", space: "s0", title: "Handoff kickoff", status: "done" },
  { address: "t5s", space: "s1", title: "general", status: "working" },
  { address: "t6j", space: "s1", title: "cmd-data", status: "working" },
];

test("roles: proxy and per-space orchestrators come from the role label", () => {
  const r = rolesOf(terms, agents);
  assert.deepEqual(r.proxy, { addr: "t5d", name: "Handoff kickoff", space: "s0", status: "done" });
  assert.deepEqual(r.leads, { s1: [{ addr: "t5s", name: "general", status: "working" }] });
});

test("roles: labels as an object or k=v strings; none labelled = no roles", () => {
  assert.deepEqual(labelsOf({ labels: ["role=proxy", "x=a=b"] }), { role: "proxy", x: "a=b" });
  assert.deepEqual(rolesOf([{ address: "t1" }], [{ address: "t1", space: "s" }]), { proxy: null, leads: {} });
});
