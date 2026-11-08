// Herdr host adapter: turns the app's live data, git, Claude transcripts and the summary cache into the
// plain input core/stage.js expects. The only file here that talks to Herdr.
import { spaces, agents, panes, terminals, exec, hc, readTextFile, home } from "herdr";
import { extractAsk } from "./core/asks.js";
import { lastAssistantText, transcriptRel } from "./core/transcript.js";

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
    if (last) data = { ...base, text: last.text, at: last.at, first: last.text.split("\n").find((l) => l.trim()) ?? "", ...extractAsk(last.text) };
  } catch {}
  msgCache.set(addr, { key, data });
  return data;
}

async function summaries() {
  try { return JSON.parse((await readTextFile(`${home()}/.cache/herdr-stage/summaries.json`)) ?? "{}"); } catch { return {}; }
}

export async function gather() {
  const sp = spaces(), ag = agents(), ps = panes(), terms = terminals(), sum = await summaries();
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
      const m = a.app === "claude-code" && a.status !== "working" ? await messageOf(a.address) : {};
      const sm = sum[a.address], fresh = sm && sm.at === m.at ? sm : null;
      return { addr: a.address, pane: a.pane, tab: a.tab_name, label: m.name || a.title || m.title || a.address, state: a.status,
        msg: m.msg, at: m.at ?? null, first: m.first, ask: m.ask ?? null, question: m.question ?? null,
        recap: fresh?.recap ?? null, yourMove: fresh?.yourMove ?? null, text: m.text ?? null, parent: a.parent ?? null };
    })());
    return { id: s.id, name: s.name, folder, git: await gitOf(folder, s.machine), agents: list };
  })());
  return { spaces: out };
}
