import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzy, search, nextSearch } from "../core/search.js";

test("fuzzy: in-order characters match, others don't", () => {
  assert.ok(fuzzy("hmd", "herdr-md"));
  assert.equal(fuzzy("dmh", "herdr-md"), null);
  assert.deepEqual(fuzzy("", "x"), { score: 0, at: [] });
});

test("fuzzy: word starts and runs beat scattered letters", () => {
  assert.ok(fuzzy("md", "herdr-md").score > fuzzy("md", "homebrew-dir").score);
  assert.ok(fuzzy("up", "upublish").score > fuzzy("up", "setup-tools-p").score);
});

test("search: every word must match some field; best first", () => {
  const cards = [
    { id: "a", fields: [{ key: "name", text: "herdr-stage", weight: 2 }, { key: "branch", text: "main" }] },
    { id: "b", fields: [{ key: "name", text: "herdr-md", weight: 2 }, { key: "branch", text: "feature/x" }] },
    { id: "c", fields: [{ key: "name", text: "life", weight: 2 }, { key: "agents", text: "herdr helper" }] },
  ];
  assert.deepEqual(search("herdr main", cards).map((r) => r.id), ["a"]);
  assert.equal(search("hmd", cards)[0].id, "b");
  assert.deepEqual(search("herdr", cards).map((r) => r.id).sort(), ["a", "b", "c"]);
  assert.equal(search("herdr", cards).at(-1).id, "c"); // name matches outrank other fields
  assert.equal(search("", cards).length, 3);
});

test("nextSearch: typing, backspace, moving, enter, esc", () => {
  let st = { query: "", sel: 0 };
  st = nextSearch(st, "h", 5); st = nextSearch(st, "m", 5);
  assert.equal(st.query, "hm");
  st = nextSearch(st, "down", 5); assert.equal(st.sel, 1);
  st = nextSearch(st, "n", 5, { control: true }); assert.equal(st.sel, 2);
  st = nextSearch(st, "backspace", 5); assert.deepEqual([st.query, st.sel], ["h", 0]);
  assert.deepEqual(nextSearch(st, "enter", 5).effect, { open: 0 });
  assert.equal(nextSearch(st, "enter", 0).effect, null);
  assert.deepEqual(nextSearch(st, "escape", 5).effect, { close: true });
  assert.equal(nextSearch({ query: "ab", sel: 3 }, "u", 5, { control: true }).query, "");
});
