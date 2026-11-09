// "New space" picker: machine, then folder, then what to start. Pure: the mod runs the scans and the
// space.new command; this decides what the lists hold and what each key does.
//
// Steps: "machine" -> "folder" -> "start". Each step is a type-to-filter list (core/search.js fuzzy).
// Enter takes the selected row to the next step; on "start" it gives { create: spaceArgs }. Esc goes back
// a step (from "machine" it closes). Tab on a folder asks the host to list its subfolders ({ expand }).
import { fuzzy, nextSearch } from "./search.js";

// The scan the host runs on the chosen machine (sh, so it works on Linux and macOS). Prints the home
// folder, the programs it can start ("@have claude"), home's own folders ("@dir /path"), then git repos
// up to four levels down.
export const SCAN = [
  'echo "$HOME"',
  'for p in claude codex; do "${SHELL:-sh}" -lc "command -v $p" >/dev/null 2>&1 && echo "@have $p"; done',
  'cd "$HOME" 2>/dev/null || exit 0',
  'for d in */; do [ -d "$d" ] && echo "@dir $HOME/${d%/}"; done',
  // Repos: stop at each .git; skip node_modules, Library and hidden folders (except ~/.config).
  'find "$HOME" -maxdepth 4 -type d \\( -name .git -print -prune -o -name node_modules -prune -o -name Library -prune -o -path "$HOME/.*" ! -path "$HOME/.config" ! -path "$HOME/.config/*" -prune \\) 2>/dev/null | sed "s#/\\.git\\$##" | head -500',
].join("\n");

// Subfolders of one folder (Tab). The folder is passed as $1, never spliced into the script.
export const LIST = 'cd "$1" 2>/dev/null && for d in */; do [ -d "$d" ] && echo "$PWD/${d%/}"; done';

export function parseScan(stdout) {
  const lines = String(stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const home = lines[0]?.startsWith("/") ? lines[0] : null;
  const have = lines.filter((l) => l.startsWith("@have ")).map((l) => l.slice(6));
  const dirs = [...new Set(lines.filter((l) => l.startsWith("@dir /")).map((l) => l.slice(5)))];
  const repos = [...new Set(lines.slice(home ? 1 : 0).filter((l) => l.startsWith("/") && l !== home))];
  return { home, have, repos, dirs };
}

export const tilde = (path, home) => (home && (path === home || path.startsWith(home + "/")) ? "~" + path.slice(home.length) : path);
export const untilde = (path, home) => (home && (path === "~" || path.startsWith("~/")) ? home + path.slice(1) : path);
const looksLikePath = (q) => /^[~/]/.test(q.trim());

// Machines: remote ones first (connected before not), then this computer.
// list: [{ name, state }] from `hc machine ls`. -> rows [{ id, machine: name|null, label, note, off }]
export function machineRows(list, query = "") {
  const remotes = (list ?? []).filter((m) => m?.name)
    .map((m) => ({ id: m.name, machine: m.name, label: m.name, note: m.state === "connected" ? "" : m.state ?? "", off: m.state !== "connected" }))
    .sort((a, b) => Number(a.off) - Number(b.off) || a.label.localeCompare(b.label));
  const rows = [...remotes, { id: "", machine: null, label: "This computer", note: "", off: false }];
  return filter(rows, query, (r) => r.label);
}

// Folders: the ones your spaces on that machine already use, then git repos, then home's own folders,
// then anything Tab expanded. A typed path (~/x or /x) not in the list comes first as "use this".
// -> rows [{ id, path, label, kind: "typed"|"space"|"repo"|"found" }]
export function folderRows({ home, repos = [], dirs = [], spaceFolders = [], extra = [] }, query = "") {
  const seen = new Set(), rows = [];
  const add = (path, kind) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    rows.push({ id: path, path, label: tilde(path, home), kind });
  };
  for (const f of spaceFolders) add(f, "space");
  const byName = (a, b) => tilde(a, home).toLowerCase().localeCompare(tilde(b, home).toLowerCase());
  for (const f of [...repos].sort(byName)) add(f, "repo");
  for (const f of [...dirs].sort(byName)) add(f, "found");
  for (const f of extra) add(f, "found");
  const q = query.trim();
  const out = filter(rows, q, (r) => r.label);
  if (looksLikePath(q)) {
    const path = untilde(q.replace(/\/+$/, "") || "/", home);
    if (!seen.has(path)) out.unshift({ id: path, path, label: tilde(path, home), kind: "typed" });
  }
  if (!q && home && !seen.has(home)) out.push({ id: home, path: home, label: "~", kind: "found" });
  return out;
}

// What the space starts with. have: programs the scan found (null = unknown, offer all).
export function startRows(have, query = "") {
  const all = [
    { id: "claude", label: "Claude Code", argv: ["claude"] },
    { id: "codex", label: "Codex", argv: ["codex"] },
    { id: "shell", label: "Shell", argv: null },
  ];
  return filter(all.filter((r) => r.id === "shell" || !have || have.includes(r.id)), query, (r) => r.label);
}

// The space.new arguments. machine "" is this computer.
export function spaceArgs({ machine, folder, start }) {
  const a = { machine: machine ?? "", folder };
  if (start?.argv) a.argv = start.argv;
  return a;
}

function filter(rows, query, text) {
  const q = String(query ?? "").trim();
  if (!q) return rows;
  // A path keeps list order (so a folder's children follow it); otherwise best match first.
  if (looksLikePath(q)) return rows.filter((r) => fuzzy(q, text(r)));
  return rows.map((r) => ({ r, m: fuzzy(q.replace(/\s+/g, ""), text(r)) })).filter((x) => x.m)
    .sort((a, b) => b.m.score - a.m.score).map((x) => x.r);
}

// Keys. st: { step, query, sel, machine, folder }. rows: the current step's rows.
// -> { st, effect } with effect { close } | { scan: machine } | { expand: path } | { create: args } | null.
export function nextOpen(st, key, rows, mods = {}) {
  // Tab, or → (in case the app keeps Tab for itself), lists the selected folder's subfolders.
  if (key === "tab" || key === "Tab" || key === "right" || key === "ArrowRight") {
    const r = rows[st.sel];
    if (st.step !== "folder" || !r) return { st, effect: null };
    return { st: { ...st, query: r.label.replace(/\/?$/, "/"), sel: 0 }, effect: { expand: r.path } };
  }
  const s = nextSearch({ query: st.query, sel: st.sel }, key, rows.length, mods);
  const next = { ...st, query: s.query, sel: s.sel };
  if (s.effect?.close) {
    if (st.step === "machine") return { st, effect: { close: true } };
    const back = st.step === "start" ? "folder" : "machine";
    return { st: { ...st, step: back, query: "", sel: 0 }, effect: null };
  }
  const pick = s.effect && "open" in s.effect ? rows[s.effect.open] : null;
  if (!pick) return { st: next, effect: null };
  if (st.step === "machine") {
    if (pick.off) return { st: next, effect: null };
    return { st: { ...next, step: "folder", machine: pick.machine, query: "", sel: 0 }, effect: { scan: pick.machine } };
  }
  if (st.step === "folder") return { st: { ...next, step: "start", folder: pick.path, query: "", sel: 0 }, effect: null };
  return { st: next, effect: { create: spaceArgs({ machine: st.machine, folder: st.folder, start: pick }) } };
}
