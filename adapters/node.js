// Node adapters for the summary job: herdr-core (`hc`), Claude Code session files,
// the `claude` CLI as the summarizer, and a JSON file store.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { globSync } from "node:fs";

const run = promisify(execFile);
const H = homedir();
const json = async (cmd, args) => JSON.parse((await run(cmd, args, { maxBuffer: 8 << 20 })).stdout);

// The transcript file for a session: ~/.claude/projects/<cwd, non-alphanumerics as "-">/<id>.jsonl
function transcriptPath(sessionId, cwd) {
  const p = join(H, ".claude/projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
  if (existsSync(p)) return p;
  return globSync(join(H, ".claude/projects/*", `${sessionId}.jsonl`))[0] ?? null;
}

// The last assistant text in a transcript, reading only the file's tail.
export function lastAssistant(path, tailBytes = 400_000) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size, start = Math.max(0, size - tailBytes);
    const buf = Buffer.alloc(size - start); readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      let e; try { e = JSON.parse(lines[i]); } catch { continue; }
      if (e.type !== "assistant") continue;
      const text = (e.message?.content ?? []).filter((c) => c?.type === "text").map((c) => c.text).join("\n").trim();
      if (text) return { text, at: e.timestamp };
    }
  } finally { closeSync(fd); }
  return null;
}

// Live Claude agents with their last message. pid -> ~/.claude/sessions/<pid>.json -> transcript.
export async function listAgents() {
  const { terminals } = await json("hc", ["ls"]);
  const out = [];
  for (const t of terminals) {
    if (t.agent !== "claude-code" || t.state !== "live") continue;
    const d = await json("hc", ["get", t.address]).catch(() => null);
    const pid = d?.foreground?.pid; if (!pid) continue;
    const sp = join(H, ".claude/sessions", `${pid}.json`); if (!existsSync(sp)) continue;
    const meta = JSON.parse(readFileSync(sp, "utf8"));
    const tp = transcriptPath(meta.sessionId, meta.cwd); if (!tp) continue;
    const last = lastAssistant(tp);
    out.push({ addr: t.address, space: (t.where ?? "").split(" / ")[0], state: t.status, title: d.title, sessionId: meta.sessionId, text: last?.text ?? null, at: last?.at ?? null });
  }
  return out;
}

// The summarizer port: a small model through the user's own `claude` login, stripped to the bone
// (no tools, no MCP, no settings, a one-line system prompt): about $0.0001 and 2 s a call.
export function makeSummarizer({ bin = join(H, ".local/bin/claude"), model = "haiku", system }) {
  return (prompt) => new Promise((resolve, reject) => {
    const p = spawn(bin, ["-p", "--model", model, "--no-session-persistence", "--output-format", "json",
      "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--system-prompt", system], { cwd: "/tmp" });
    let out = "", err = "";
    p.stdout.on("data", (b) => (out += b)); p.stderr.on("data", (b) => (err += b));
    p.on("close", (code) => {
      try { const d = JSON.parse(out); if (d.is_error) throw new Error(d.result || "model error");
        resolve({ text: d.result, cost: d.total_cost_usd ?? null, model }); }
      catch (e) { reject(new Error(`summarizer failed (exit ${code}): ${e.message} ${err.slice(0, 200)}`)); }
    });
    p.stdin.end(prompt);
  });
}

// The store: one JSON file, written atomically so a reader never sees half a file.
export function fileStore(path = join(H, ".cache/herdr-stage/summaries.json")) {
  return {
    path,
    read() { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; } },
    write(all) { mkdirSync(dirname(path), { recursive: true }); const tmp = path + ".tmp"; writeFileSync(tmp, JSON.stringify(all, null, 1)); renameSync(tmp, path); },
  };
}
