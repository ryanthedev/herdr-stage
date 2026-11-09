# Resume point (update this before handing off)

## 2026-11-09: Stage follows Heel's overview (user: "more of that route")
- Look and anatomy come from Heel (~/repos/herdr-mobile, .design-loop/heel-bulky/r0/directions-v4.html,
  Skins/MissionSkin.swift): graphite ground, mint for working, amber only for needs-you; rows on the ground
  split by hairlines (no cards); header = name + status word; mono meta line; one message bubble per item
  ([tab chip] name · time / session title / message), needs-you first; bottom = status line + "Jump to a
  space" field (/ focuses it). No big header. Palette: MISSION in mod/themes.js (fixed, like Heel).
- Screen previews removed (Heel's call: show what the space needs from you, not raw terminal lines).
- core/rows.js tiers now: wide >= 420 (bubbles as many as fit, +N), s >= 300 (one bubble), xs (name line).
- Heel never-list applies here too: no agent icons on spaces, no activity bars, no bare numbers without a
  label, no selected-tab states.

## 2026-11-08 (late): one space per row, adapting to width
- User rejected every card style (the 4 dealt directions in .design-foundations/dna/stage-pane/sheet.html and
  Codex's pass). Asked instead for: each space a full row, its items as mini thumbnails, less info as the pane
  narrows, current space pinned. Layout mock: .design-foundations/dna/stage-pane/adaptive.html.
- core/rows.js: tiers xl>=900 (thumbnails + screen previews), l>=640 (agents keep previews), m>=420 (chips),
  s>=300 (one line + ask), xs. Row heights are computed (virtual list can't measure). Pinned current space sits
  above the list and is left out of it.
- Previews: Claude agents show the end of their last message (their screen is just the input box); shells
  and processes show `hc read` (last lines, box-drawing rules dropped). Fetched only in xl/l tiers.
- Width bug fixed: on_size_change fires only for a new element or a changed size, so after a hot reload into a
  same-size pane the old root id never reported; the root id now has a per-instance nonce.
- GPUI gotcha: preview lines need fixed-height divs (h(11) + truncate); with whitespace_nowrap and a numeric
  line_height they rendered nothing.
- Look is still open: user hasn't liked any style yet; asked them for a reference app or what was ugly.

## 2026-11-08 (night): order, nesting, search, non-agent panes, Codex design pass
- Order (core/order.js): blocked/your-move spaces first, then score = decayed dwell minutes + 5 per switch +
  up to 60 for recent activity (half-life 72h). Presence is recorded by Stage itself in shared("stage.presence"),
  only while a Stage pane is mounted (Herdr keeps no focus history). Order recomputes on refresh (10s) only.
- Nesting (core/nest.js): `hc label <t> stage.parent=<space name|id>` on any terminal in the child space.
  Families start a new grid row (core/grid.js layoutRows); a high-ranked child lifts its family. Cycles drop.
  Not tried with a real label yet (would touch the user's live terminals); unit-tested only.
- Search (core/search.js): `/` opens a Telescope-style fuzzy filter, one column, matched letters highlighted;
  ctrl-n/p or arrows, Enter goes, Esc back. Seam: stage-test.json {"find": "q"} in a test home.
- Cards also list non-agent panes (adapter otherOf): dashboards (mod panes), processes, shells. The stage
  pane itself is excluded.
- Codex (sdd, effort high) did the visual pass: surfaces/tints in themes.js, nest connector. Modest change.

## 2026-11-08 (latest): Stage pane is a card grid; roles dropped
- User disliked the list + proxy/orchestrator rows. mod/main.js now draws every space as a fixed-height card
  (name, folder/branch, counts, top 2 agents with their ask or line, +N more) in a grid sized from the pane width.
- Keys: core/grid.js nextGrid (h/l along a row, j/k a row, g/G, enter, q); colsFor/rowOf/rowsFor. Tests in test/grid.test.mjs.
- Scrolling: the grid is a v_virtual_list of rows with a VirtualListScrollHandle; moving the selection calls
  scroll_to_item(row). Virtual-list renderers can't hold handlers, so clicks = wrapper mouse-down (column) +
  on_item_click (row key): single click selects, Enter opens.
- Removed: core/roles.js, ROLES.md, core/list.js and their tests. Proxy bar and "led by" lines are gone.
- Design pass: raised cards (shadow_md, shadow_xl when selected), lit top edge, "!" ask glyphs, ages, pill header.
- Verified: renders in an isolated test window. Installed into the main Herdr 2026-11-08. NOT verified by hand: hjkl and
  scroll-follow (no key automation allowed).

## 2026-11-08 (later): Stage is now a side pane, not a popup
- User found the popup ugly and asked for a side pane they can move focus into, like herdr-md. v1 shows only
  the list of all spaces: mod/main.js (pane view, "focusable": true), core/list.js (j/k/g/G/enter/q reducer).
- cmd-g (layout:matrix in ~/.config/herdr-app/keys.json) = pane.split right {mod:"stage"}; a second cmd-g in
  the same tab focuses the existing pane and closes the new one. Enter = space.select (the pane stays in the
  old space's tab, so it disappears from view after the switch: next thing to decide).
- The popup (cards, canvas, zoom, noir) is kept in mod/dialog.js, not installed. Its notes below still apply.


**Updated:** 2026-11-08, #220 done + wheel zoom/pan + measured heights; installed and loading in the main Herdr (restarted 5:34 PM).

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
- Wheel sign: GPUI delta.y > 0 = content moves down (GPUI scroll areas add delta to the offset; the herdr-md
  viewer, whose scrolling works, reads it the same way). Pan follows that. Cmd-scroll zoom follows the hand
  (fingers/wheel up or away = zoom in): core awayOf(dy, natural); the mod reads macOS natural scrolling with
  `defaults read -g com.apple.swipescrolldirection` (absent on this Mac = default = natural on).
- Still not tried by hand: no real scroll has been sent (no input injection allowed). The user should try
  plain scroll and cmd-scroll once; if either is reversed, the fix is in core/canvas.js wheelStep/awayOf.

## Next
- Summary job in the background once the user's usage governor allows (user's call, still paused).
- User to try scrolling on the canvas (cmd-g, Enter on a space): plain scroll pans, cmd-scroll up/away zooms in.
- Stray copy ~/.cache/hdt/mods/stage (another session's test home) could not be removed here; user's call.

## How to test natively without touching the user's Herdr
1. `rsync -a --exclude telemetry --exclude '*.bak*' --exclude shared.json --exclude window.json
   --exclude windows.json --exclude mods/mobile-bridge --exclude '*.sock' ~/.config/herdr-app/ <scratch>/herdr-test2/`
   then set sounds off in its settings.json and drop the mobile-bridge block from layouts/matrix.json.
2. Short path (unix socket limit ~104 chars): `ln -sfn <scratch>/herdr-test2 ~/.cache/hst`
3. Launch in background with Claude's session env stripped (the `env -u` line in `CLAUDE.md`; never launch Herdr from a Claude shell without it)
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
