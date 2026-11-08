// Claude Code transcripts: pure parsing of a .jsonl tail. Hosts read the bytes; this finds the message.

// ~/.claude/projects/<cwd with every non-alphanumeric as "-">/<sessionId>.jsonl
export const transcriptRel = (sessionId, cwd) => `.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}/${sessionId}.jsonl`;

// The last assistant text in a chunk of JSONL (a tail may start mid-line; bad lines are skipped).
export function lastAssistantText(jsonlTail) {
  const lines = String(jsonlTail ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e?.type !== "assistant") continue;
    const text = (e.message?.content ?? []).filter((c) => c?.type === "text").map((c) => c.text).join("\n").trim();
    if (text) return { text, at: e.timestamp ?? null };
  }
  return null;
}
