// Herdr host adapter: turns the app's live data, git, Claude transcripts and the summary cache into the
// plain input core/stage.js expects. The only file here that talks to Herdr.
import { spaces, agents, panes, terminals, exec, hc, readTextFile, home } from "herdr";
import { extractAsk } from "./core/asks.js";
import { lastAssistantText, lastUserPrompt, titleOf, transcriptRel } from "./core/transcript.js";
import { mdGist, dashOf } from "./core/dash.js";

const GIT_TTL = 60000;
// Mods share one script engine, and a mod that runs it out of memory breaks every mod until Herdr restarts
// (seen 2026-11-08). So transcript reads stay small (the last message is near the end), run one at a time,
// and only for agents that have stopped: a working agent's message isn't used.
const TAIL_BYTES = 64000;
const gitCache = new Map();   // machine|folder -> { at, git }
const msgCache = new Map();   // terminal -> { key, data }

async function gitOf(folder, machine) {
  if (!folder) return null;
  const k = `${machine ?? ""}|${folder}`, hit = gitCache.get(k);
  if (hit && Date.now() - hit.at < GIT_TTL) return hit.git;
  const g = (args) => exec("git", ["-C", folder, ...args], { on: machine }).then((r) => (r.code === 0 ? r.stdout : ""), () => "");
  const top = (await g(["rev-parse", "--show-toplevel"])).trim();
  let git = null;
  if (top) {
    const [wt, br, cur] = await Promise.all([g(["worktree", "list", "--porcelain"]), g(["for-each-ref", "--format=%(refname:short)", "refs/heads"]), g(["branch", "--show-current"])]);
    git = { branch: cur.trim() || "detached", worktrees: wt.split("\n").filter((l) => l.startsWith("worktree ")).length, branches: br.split("\n").filter(Boolean).length };
  }
  gitCache.set(k, { at: Date.now(), git });
  return git;
}

// An agent's last message: terminal -> its process -> ~/.claude/sessions/<pid>.json -> transcript tail.
// Cached until the terminal's status changes, so an idle fleet costs one `hc get` per agent per refresh.
async function messageOf(addr) {
  let d; try { d = JSON.parse((await hc(["get", addr])).stdout); } catch { return {}; }
  const pid = d.foreground?.pid, key = `${pid}:${d.status_ms}:${d.turn}`;
  const hit = msgCache.get(addr); if (hit?.key === key) return hit.data;
  const base = { msg: d.status?.msg ?? null, title: d.title ?? null, name: d.name ?? null };
  let data = base;
  try {
    const meta = JSON.parse(await readTextFile(`${home()}/.claude/sessions/${pid}.json`));
    const tail = await exec("tail", ["-c", String(TAIL_BYTES), `${home()}/${transcriptRel(meta.sessionId, meta.cwd)}`]);
    const last = tail.code === 0 ? lastAssistantText(tail.stdout) : null;
    // The title follows what you last asked; Claude's own title (base.title) is the fallback.
    // Prompts can sit far above the tail after a long turn, so grep the whole file for prompt lines only
    // (no tool results, no harness meta, none over 200 KB such as pasted images) and keep the last few.
    const PROMPTS = `grep -E '"type":"(user|queue-operation)"' "$1" | grep -v '"tool_result"' | grep -v '"isMeta":true' | awk 'length($0) < 200000' | tail -n 4`;
    const pr = await exec("sh", ["-c", PROMPTS, "sh", `${home()}/${transcriptRel(meta.sessionId, meta.cwd)}`]).catch(() => null);
    const asked = pr?.code === 0 ? titleOf(lastUserPrompt(pr.stdout)?.text) : null;
    if (asked) data = { ...data, asked };
    if (last) data = { ...data, text: last.text, at: last.at, first: last.text.split("\n").find((l) => l.trim()) ?? "", ...extractAsk(last.text) };
  } catch {}
  msgCache.set(addr, { key, data });
  return data;
}

async function summaries() {
  try { return JSON.parse((await readTextFile(`${home()}/.cache/herdr-stage/summaries.json`)) ?? "{}"); } catch { return {}; }
}

// Mod panes' props (herdr-md / herdr-draw keep their file in props.file), from the layout document over
// `hc connect`: panes() doesn't carry props. One call per refresh.
async function modProps() {
  const req = '{"jsonrpc":"2.0","id":0,"method":"hello","params":{"generation":1}}\n{"jsonrpc":"2.0","id":1,"method":"doc.get","params":{"name":"herdr-app"}}\n';
  const r = await exec("sh", ["-c", 'printf "%s" "$1" | hc connect', "sh", req]).catch(() => null);
  const out = {};
  for (const line of String(r?.stdout ?? "").split("\n")) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m?.id !== 1) continue;
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (n.content?.mod && n.id) out[n.id] = n.content.props ?? null;
      for (const c of n.children ?? []) walk(c);
    };
    for (const s of m.result?.value?.spaces ?? []) for (const t of s.tabs ?? []) walk(t.root);
  }
  return out;
}

// What a dashboard's file holds, cached by path and mtime: a markdown file's opening (first 4 KB),
// a board's shape count (counted with grep, so a board full of images is never loaded into the engine).
const fileCache = new Map();
async function fileFacts(path, mod) {
  const st = await exec("stat", ["-f", "%m", path]).catch(() => null);
  if (st?.code !== 0) return null;
  const mtimeMs = Number(st.stdout.trim()) * 1000, hit = fileCache.get(path);
  if (hit?.mtimeMs === mtimeMs) return hit;
  const facts = { path, mtimeMs };
  if (mod === "herdr-draw") {
    const c = await exec("sh", ["-c", `grep -o '"versionNonce"' "$1" | wc -l`, "sh", path]).catch(() => null);
    if (c?.code === 0) facts.shapes = Number(c.stdout.trim());
  } else {
    const h = await exec("head", ["-c", "4000", path]).catch(() => null);
    if (h?.code === 0) facts.gist = mdGist(h.stdout);
  }
  fileCache.set(path, facts);
  return facts;
}

// A pane that isn't an agent: { kind: "mod" | "shell" | "process", label, detail, tab, pane }.
async function otherOf(p, tab, props) {
  const short = (d) => (d || "").replace(/^\/Users\/[^/]+/, "~");
  if (!p.terminal) {
    const pr = props[p.pane] ?? null, file = typeof pr?.file === "string" ? await fileFacts(pr.file, p.mod) : null;
    const d = dashOf(p.mod, pr, file, home());
    return { kind: "mod", label: d.label, detail: d.text, at: d.at, tab, pane: p.pane, terminal: null };
  }
  const shell = p.program?.shell || p.program?.key === "shell";
  return { kind: shell ? "shell" : "process", label: shell ? p.program?.name || "shell" : p.program?.name || p.title, detail: short(p.cwd), tab, pane: p.pane, terminal: p.terminal };
}

export async function gather() {
  const sp = spaces(), ag = agents(), ps = panes(), terms = terminals(), sum = await summaries(), props = await modProps();
  const out = [];
  for (const s of sp) out.push(await (async () => {
    const tabIds = new Set(s.tabs.map((t) => t.id));
    const folder = ps.find((p) => tabIds.has(p.tab) && p.cwd)?.cwd ?? s.folder;
    const paned = ag.filter((a) => a.space === s.id);
    const listed = new Set(paned.map((a) => a.address));
    // Helpers an agent started (sub-agents): live terminals whose parent is one of this space's agents.
    const helpers = terms.filter((t) => t.parent && listed.has(t.parent) && t.state === "live" && !listed.has(t.address))
      .map((t) => ({ address: t.address, pane: null, tab_name: paned.find((a) => a.address === t.parent)?.tab_name, status: t.status === "error" ? "blocked" : t.status ?? "working",
        title: t.name || t.template || t.program?.name || t.address, app: t.app ?? t.program?.key ?? "claude-code", parent: t.parent }));
    const mine = [...paned, ...helpers];
    const list = [];
    for (const a of mine) list.push(await (async () => {
      // Working agents are read too, for the title; their message and ask wait until they stop.
      const read = a.app === "claude-code" ? await messageOf(a.address) : {};
      const m = a.status !== "working" ? read : { asked: read.asked, title: read.title, name: read.name };
      const sm = sum[a.address], fresh = sm && sm.at === m.at ? sm : null;
      return { addr: a.address, pane: a.pane, tab: a.tab_name, label: m.name || a.title || m.title || a.address, state: a.status,
        msg: m.msg, at: m.at ?? null, first: m.first, ask: m.ask ?? null, question: m.question ?? null,
        recap: fresh?.recap ?? null, yourMove: fresh?.yourMove ?? null, text: m.text ?? null, parent: a.parent ?? null,
        title: m.asked ?? m.title ?? a.title ?? null };
    })());
    // Everything else in the space: mod panes (dashboards like herdr-md or draw), shells and other processes.
    const tabName = Object.fromEntries(s.tabs.map((t) => [t.id, t.name]));
    const others = [];
    for (const p of ps.filter((p) => tabIds.has(p.tab) && p.mod !== "stage" && !listed.has(p.terminal) && !(p.status || p.program?.agent)))
      others.push(await otherOf(p, tabName[p.tab], props));
    return { id: s.id, name: s.name, folder, git: await gitOf(folder, s.machine), agents: list, others };
  })());
  return { spaces: out };
}
