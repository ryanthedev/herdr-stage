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

// What you last asked an agent: the newest real prompt in a chunk of JSONL, so a bubble's title follows the
// work (Claude Code's own ai-title is written once, from the first prompt, and never changes). Real prompts
// are plain user text: not tool results, not harness meta (skill bodies, image notes), not slash commands.
// Messages sent mid-turn land first as a queue "enqueue"; they count too.
export function lastUserPrompt(jsonlTail) {
  const lines = String(jsonlTail ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch { continue; }
    let text = null;
    if (e?.type === "queue-operation" && e.operation === "enqueue" && typeof e.content === "string") text = e.content;
    else if (e?.type === "user" && !e.isMeta && !e.isSidechain) {
      const c = e.message?.content;
      text = typeof c === "string" ? c : Array.isArray(c) && !c.some((x) => x?.type === "tool_result")
        ? c.filter((x) => x?.type === "text").map((x) => x.text).join("\n") : null;
    }
    text = String(text ?? "").replace(/<([a-z-]+)>[\s\S]*?<\/\1>/g, "").replace(/\[Image[^\]]*\]/g, "").trim();
    if (!text || text.startsWith("<command-") || text.startsWith("Base directory for this skill")) continue;
    return { text, at: e.timestamp ?? null };
  }
  return null;
}

// A prompt as a short title: its first sentence, conversational lead-ins dropped, capitalised, at most `max`
// characters (cut at a word). null when nothing title-like is left.
export function titleOf(prompt, max = 72) {
  const line = String(prompt ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  let s = (line.match(/^.*?[.?!](?=\s|$)/)?.[0] ?? line).replace(/[.?!]+$/, "");
  const LEAD = /^(?:(?:ok(?:ay)?|yeah|yes|so|also|and|hmm+|alright|great|cool|now|then|please)\b[,.!]?\s*|(?:can|could|would) (?:we|you)(?: please)?\s+|let'?s\s+|(?:i )?(?:want|need) (?:you )?to(?: please)?\s+)/i;
  for (let prev = null; prev !== s; ) { prev = s; s = s.replace(LEAD, ""); }
  s = s.trim();
  if (s.length < 4) return null;
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return s[0].toUpperCase() + s.slice(1);
}
