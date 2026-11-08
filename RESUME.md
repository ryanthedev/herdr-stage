# Resume point (update this before handing off)

**Updated:** 2026-11-08, #220 done + wheel zoom/pan + measured card heights; installed in the main Herdr.

## Done
- Summary-on-idle: core/summary.js, adapters/node.js, bin/summary-job.mjs (NOT running in background:
  user holds it until the usage governor allows). Hand-off asks fixed (#218), live eval 4/4.
- Native stage v1 (cmd-g in layout:matrix): core/stage.js + core/nav.js + mod/. Verified in an isolated Herdr.
- POC (browser, not in git): ~/.design-loop/herdr/r2/poc.html (both themes, 6-step type scale),
  build notes ~/.design-loop/herdr/r2/BUILD.md. Use it as the visual reference for the canvas.

## Done: canvas level v1 (native)
core/canvas.js (layout, elbow edge segments, spatial nearest, camera), nextCanvas in core/nav.js; the mod's
Enter on a stage card opens the canvas, Esc returns. Helpers come from terminals() (parent) and open with
agent.focus. Recap drawer (Space) shows the summary and the last message. Screens: docs/native-*-v1.png.
Test seam: stage-test.json in an isolated home's root ({"space","sel","drawer","theme","zoom","wheel"}) opens a canvas without keys.

## Done: #220 neon noir + canvas zoom (native)
- Theme: mod/themes.js holds every colour/font as tokens ("default" follows the Herdr theme, "noir" is the POC
  palette). `t` toggles at both levels (core nav effect {theme:"toggle"}); saved in shared("stage.theme").
  Default stays the default until the user picks noir. Noir stand-ins for glow/tracking: caps in Avenir Next
  Condensed, weight 700, cyan focus border + shadow_lg on the selection, pink your-move borders.
- Zoom: core/canvas.js scaleLayout/fitZoom/clampZoom/detailAt (ZOOM 0.35-2, step 0.15, auto-fit floor 0.6);
  keys `+`/`=` `-` `0` (fit) in nextCanvas; clickable − % + fit bar bottom left. Semantic zoom: below 0.55
  cards show name (+ ask), below 0.8 name + meta, else full; layoutCanvas(space, detail) sizes cards to match.
  The skin draws/navigates the detail layout; fit zoom comes from the full one (view.fit).
- Seam now also takes "theme" and "zoom". Screens: docs/native-*-noir*.png. 28 tests.

## Done: wheel/trackpad + measured heights
- No pinch/gesture event exists in this GPUI build. on_scroll_wheel on the canvas: plain scroll pans (cst.cam,
  a free camera; keys that move selection/zoom hand it back), cmd/ctrl+scroll zooms about the pointer
  (core wheelStep/wheelCanvas; keepInView stops the tree leaving the screen).
- Cards draw at natural height and report it with on_size_change; core measure() (2px tolerance) feeds
  layoutCanvas(space, detail, heights). Heights kept per space and detail level.
- Seam takes "wheel": [{dx,dy,px,py,zoom}] (canvas px) to exercise the pan/zoom path without input.
- UNVERIFIED live: GPUI's raw wheel event decoding (delta sign, px vs lines, local_position units). Nobody may
  inject scroll into a window here; if scrolling feels inverted, flip the sign in mod/main.js wheel().

## Next
- Summary job in the background once the user's usage governor allows (user's call, still paused).
- The user's main Herdr has the mod installed (~/.config/herdr-app/mods/stage); it shows after their restart.

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
- This session's shell inherits HERDR_APP_HOME=~/.cache/hdt (another session's test home). Always pass
  HERDR_APP_HOME explicitly to install.sh and herdr-app, or you install into someone else's window.
- Mods share one script engine; one mod out of memory breaks all mods until Herdr restarts. Keep reads small.
- on_size_change reports px times the app zoom (1.2): divide by settings().zoom.
- A flex-wrap row that exactly fills its width wraps early by the scrollbar: keep SLACK px spare.
- The user's main Herdr needed a restart (2026-11-08) after another session's OOM; don't restart it yourself.
- ~/.config commits: other sessions stage things there; commit only your paths (temp GIT_INDEX_FILE).
