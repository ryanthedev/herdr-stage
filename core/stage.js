// The stage view-model: one card per space, the "your move" lane. Pure: hosts pass plain objects.
//
// input: { spaces: [{ id, name, folder, git: {branch, worktrees, branches}|null, others: [{ kind, label, detail, tab, pane }],
//                     agents: [{ addr, pane, tab, label, state, msg, at, ask, question, recap, yourMove, first }] }] }
import { moveOf, clean } from "./asks.js";

const RANK = { blocked: 5, working: 3, done: 2, idle: 1 };

export function agentRow(a) {
  const move = moveOf(a);
  const line = a.state === "working" ? clean(a.msg || a.first) : clean(a.recap || a.first);
  return { addr: a.addr, pane: a.pane ?? null, label: a.label, state: a.state, at: a.at, tab: a.tab, line: line || null, move: move?.text ?? null, moveRank: move?.rank ?? 0, recap: a.recap ?? null, text: a.text ?? null };
}

const order = (x, y) => (y.moveRank ? 9 : 0) + RANK[y.state] - ((x.moveRank ? 9 : 0) + RANK[x.state]) || String(y.at ?? "").localeCompare(String(x.at ?? ""));

export function buildStage({ spaces }, { top = 3 } = {}) {
  const cards = spaces.map((s) => {
    const rows = s.agents.map(agentRow).sort(order);
    const counts = { move: rows.filter((r) => r.move).length, working: rows.filter((r) => r.state === "working").length };
    counts.idle = rows.length - counts.move - counts.working;
    const g = s.git;
    const facts = [s.folder?.replace(/^\/Users\/[^/]+/, "~") || "~", g ? `⎇ ${g.branch}` : "no repo yet",
      g && g.worktrees > 1 ? `${g.worktrees} worktrees` : null, g && g.branches > 1 ? `${g.branches} branches` : null].filter(Boolean);
    // Non-agent panes: dashboards (mods) first, then running processes, then plain shells.
    const KIND = { mod: 0, process: 1, shell: 2 };
    const others = [...(s.others ?? [])].sort((x, y) => KIND[x.kind] - KIND[y.kind]);
    counts.mods = others.filter((o) => o.kind === "mod").length;
    counts.shells = others.filter((o) => o.kind === "shell").length;
    counts.procs = others.filter((o) => o.kind === "process").length;
    return { id: s.id, name: s.name, loose: !g, facts, counts, rows, top: rows.slice(0, top), more: Math.max(0, rows.length - top), hasMove: counts.move > 0, others };
  });
  // Spaces with a repo first, then the ones without a space yet; the order inside each stays the space order.
  const ordered = [...cards.filter((c) => !c.loose), ...cards.filter((c) => c.loose)];
  const lane = ordered.flatMap((c) => c.rows.filter((r) => r.move).map((r) => ({ space: c.id, spaceName: c.name, ...r })))
    .sort((x, y) => y.moveRank - x.moveRank);
  return { cards: ordered, lane, placed: ordered.filter((c) => !c.loose).length };
}
