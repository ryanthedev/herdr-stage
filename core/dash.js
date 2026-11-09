// Dashboards (mod panes such as herdr-md and herdr-draw) as bubbles: what file they show and what's in it.
// Pure: the adapter reads the layout's pane props and the file; this turns them into a bubble's words.

const NAMES = { "herdr-md": "Markdown", "herdr-draw": "Board" };

// The opening of a markdown file: its first heading, then its first line of prose. Front matter, code
// fences, images and markup are skipped.
export function mdGist(text) {
  const lines = String(text ?? "").replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
  let heading = null, prose = null, fence = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith("```")) { fence = !fence; continue; }
    if (fence || !l || /^(!\[|<|\||[-*_]{3,}$)/.test(l)) continue;
    const h = l.match(/^#{1,6}\s+(.*)$/);
    if (h) { if (!heading) heading = h[1]; continue; }
    if (!prose) prose = l.replace(/^[-*+>]\s+|^\d+\.\s+/, "").replace(/\*\*|__|`|\[([^\]]*)\]\([^)]*\)/g, "$1");
    if (heading && prose) break;
  }
  return [heading, prose].filter(Boolean).join(" — ") || null;
}

// A dashboard bubble: { label, text, at }. `file` is { path, mtimeMs, gist?, shapes? } when the pane has one.
export function dashOf(mod, props, file, home = "") {
  const name = NAMES[mod] ?? mod;
  if (!file?.path) {
    const what = mod === "herdr-draw" ? "board" : "file";
    return { label: name, text: props?.pick ? `Choosing a ${what}` : name, at: null };
  }
  const base = file.path.split("/").pop(), full = file.path.slice(0, -base.length - 1);
  const dir = home && full.startsWith(home) ? "~" + full.slice(home.length) : full;
  const about = mod === "herdr-draw"
    ? (file.shapes != null ? `${file.shapes} ${file.shapes === 1 ? "shape" : "shapes"}` : null)
    : file.gist;
  return { label: base, text: [about, dir].filter(Boolean).join("\n"), at: file.mtimeMs != null ? new Date(file.mtimeMs).toISOString() : null };
}
