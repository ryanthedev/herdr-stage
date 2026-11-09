import { test } from "node:test";
import assert from "node:assert/strict";
import { mdGist, dashOf } from "../core/dash.js";

test("mdGist: first heading and first prose line, markup dropped", () => {
  assert.equal(mdGist("---\ntitle: x\n---\n# Hero\n\n![img](a.png)\nThe **fast** way to [read](u) docs.\n"), "Hero — The fast way to read docs.");
  assert.equal(mdGist("```\ncode\n```\n- just a list item"), "just a list item");
  assert.equal(mdGist(""), null);
});

test("dashOf: file name as label, gist and folder as text, mtime as at", () => {
  const md = dashOf("herdr-md", { file: "/Users/r/x/hero.md" }, { path: "/Users/r/x/hero.md", mtimeMs: 0, gist: "Hero" }, "/Users/r");
  assert.deepEqual(md, { label: "hero.md", text: "Hero\n~/x", at: new Date(0).toISOString() });
  const d = dashOf("herdr-draw", {}, { path: "/b/plan.excalidraw", shapes: 1 });
  assert.equal(d.text, "1 shape\n/b");
  assert.deepEqual(dashOf("herdr-draw", { pick: true }, null), { label: "Board", text: "Choosing a board", at: null });
});
