import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScan, machineRows, folderRows, startRows, nextOpen, spaceArgs, tilde, untilde } from "../core/open.js";

test("parseScan reads home, programs and folders", () => {
  const s = parseScan("/home/r\n@have claude\n@dir /home/r/src\n/home/r/src/api\n/home/r/src/api\n");
  assert.equal(s.home, "/home/r");
  assert.deepEqual(s.have, ["claude"]);
  assert.deepEqual(s.dirs, ["/home/r/src"]);
  assert.deepEqual(s.repos, ["/home/r/src/api"]);
});

test("tilde and untilde round-trip only inside home", () => {
  assert.equal(tilde("/home/r/x", "/home/r"), "~/x");
  assert.equal(tilde("/home/rx", "/home/r"), "/home/rx");
  assert.equal(untilde("~/x", "/home/r"), "/home/r/x");
});

test("machines: remote connected first, this computer last, offline marked", () => {
  const rows = machineRows([{ name: "vana", state: "disconnected" }, { name: "ska", state: "connected" }]);
  assert.deepEqual(rows.map((r) => r.label), ["ska", "vana", "This computer"]);
  assert.equal(rows[1].off, true);
  assert.deepEqual(machineRows([{ name: "ska", state: "connected" }], "sk").map((r) => r.machine), ["ska"]);
});

test("folders: space folders first, typed path offered, home at the end", () => {
  const scan = { home: "/h", dirs: ["/h/b", "/h/a"], spaceFolders: ["/h/b"] };
  assert.deepEqual(folderRows(scan).map((r) => r.label), ["~/b", "~/a", "~"]);
  const typed = folderRows(scan, "~/new/thing");
  assert.equal(typed[0].kind, "typed");
  assert.equal(typed[0].path, "/h/new/thing");
  assert.deepEqual(folderRows(scan, "~/a").map((r) => r.path), ["/h/a"]);
  assert.deepEqual(folderRows(scan, "a").map((r) => r.path), ["/h/a"]);
});

test("folders: repos before plain home folders", () => {
  const rows = folderRows({ home: "/h", repos: ["/h/src/z"], dirs: ["/h/Desktop"] });
  assert.deepEqual(rows.map((r) => [r.label, r.kind]), [["~/src/z", "repo"], ["~/Desktop", "found"], ["~", "found"]]);
});

test("start options follow what the machine has", () => {
  assert.deepEqual(startRows(["claude"]).map((r) => r.id), ["claude", "shell"]);
  assert.deepEqual(startRows(null).map((r) => r.id), ["claude", "codex", "shell"]);
});

test("keys walk machine -> folder -> start -> create, esc steps back", () => {
  let st = { step: "machine", query: "", sel: 0 };
  const ms = machineRows([{ name: "ska", state: "connected" }]);
  let r = nextOpen(st, "enter", ms);
  assert.deepEqual(r.effect, { scan: "ska" });
  assert.equal(r.st.step, "folder");
  const fs = folderRows({ home: "/h", dirs: ["/h/api"] });
  assert.deepEqual(nextOpen(r.st, "right", fs).effect, { expand: "/h/api" });
  r = nextOpen(r.st, "tab", fs);
  assert.deepEqual(r.effect, { expand: "/h/api" });
  assert.equal(r.st.query, "~/api/");
  r = nextOpen({ ...r.st, query: "", sel: 0 }, "enter", fs);
  assert.equal(r.st.step, "start");
  assert.equal(r.st.folder, "/h/api");
  const back = nextOpen(r.st, "escape", startRows(null));
  assert.equal(back.st.step, "folder");
  r = nextOpen(r.st, "enter", startRows(null));
  assert.deepEqual(r.effect, { create: { machine: "ska", folder: "/h/api", argv: ["claude"] } });
  assert.deepEqual(nextOpen({ step: "machine", query: "", sel: 0 }, "escape", ms).effect, { close: true });
});

test("offline machine can't be picked; local is machine ''", () => {
  const ms = machineRows([{ name: "vana", state: "disconnected" }]);
  assert.equal(nextOpen({ step: "machine", query: "", sel: 0 }, "enter", ms).effect, null);
  assert.deepEqual(spaceArgs({ machine: null, folder: "/x", start: { argv: null } }), { machine: "", folder: "/x" });
});
