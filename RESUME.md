# Resume point (update this before handing off)

**Updated:** 2026-11-08, mid canvas build (session ~/.config, Claude Code).

## Done
- Summary-on-idle: core/summary.js, adapters/node.js, bin/summary-job.mjs (NOT running in background:
  user holds it until the usage governor allows). Hand-off asks fixed (#218), live eval 4/4.
- Native stage v1 (cmd-g in layout:matrix): core/stage.js + core/nav.js + mod/. Verified in an isolated Herdr.
- POC (browser, not in git): ~/.design-loop/herdr/r2/poc.html (both themes, 6-step type scale),
  build notes ~/.design-loop/herdr/r2/BUILD.md. Use it as the visual reference for the canvas.

## In progress: canvas level (inside a space), native
Plan: core/canvas.js (pure layout: space -> tabs -> agents -> helpers; fixed node sizes, elbow edges as
axis-aligned segments) + canvas nav (spatial nearest agent; Enter opens agent, Space drawer, Esc back to
stage) in core/nav.js; adapter adds helpers from terminals() (parent); mod draws nodes absolutely
positioned in a world panned by a camera (no zoom in v1). Stage Enter on a card switches to the canvas
instead of closing.

## How to test natively without touching the user's Herdr
1. `rsync -a --exclude telemetry --exclude '*.bak*' --exclude shared.json --exclude window.json
   --exclude windows.json --exclude mods/mobile-bridge --exclude '*.sock' ~/.config/herdr-app/ <scratch>/herdr-test2/`
   then set sounds off in its settings.json and drop the mobile-bridge block from layouts/matrix.json.
2. Short path (unix socket limit ~104 chars): `ln -sfn <scratch>/herdr-test2 ~/.cache/hst`
3. Launch in background: `HERDR_APP_HOME=/Users/r/.cache/hst /Applications/Herdr.app/Contents/MacOS/Herdr`
4. `HERDR_APP_HOME=~/.cache/hst ./scripts/install.sh`, then `herdr-app do mod.open '{"name":"stage"}'`,
   `herdr-app shot`, `herdr-app status` (errors). Close: stop the background task, `unlink ~/.cache/hst`.
Never automate keys on the user's real display; keyboard behaviour is covered by core tests.

## Gotchas
- Mods share one script engine; one mod out of memory breaks all mods until Herdr restarts. Keep reads small.
- on_size_change reports px times the app zoom (1.2): divide by settings().zoom.
- A flex-wrap row that exactly fills its width wraps early by the scrollbar: keep SLACK px spare.
- The user's main Herdr needed a restart (2026-11-08) after another session's OOM; don't restart it yourself.
- ~/.config commits: other sessions stage things there; commit only your paths (temp GIT_INDEX_FILE).
