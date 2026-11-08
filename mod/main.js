// Stage: every space as a card, what each agent needs from you, and a lane of "your move" items.
// Opened with mod.open:stage (keys.json); a full-window dialog over the work.
//
// Hexagonal: data comes in through ./adapter.js, the view-model and keyboard behaviour come from ./core
// (shared with the browser POC and the tests); this file only draws and forwards keys.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, run, props, closeOverlay, settings, readTextFile, appHome, shared, setShared, exec } from "herdr";
import { gather } from "./adapter.js";
import { buildStage } from "./core/stage.js";
import { next, initial, nextCanvas, zoomOf, wheelCanvas } from "./core/nav.js";
import { layoutCanvas, edgeSegments, camera, firstAgent, scaleLayout, detailAt, measure } from "./core/canvas.js";
import { tokens, THEMES } from "./themes.js";

// Six sizes on an 18px base: the whole type scale.
const T = { cap: 14, sm: 16, body: 18, sub: 22, title: 30, display: 38 };
const PAD = 40, GAP = 24, CARD_MIN = 540, PICKER = 620;
const SLACK = 24; // room for the scroll bar, so a full row never wraps by a few px

function ago(iso) {
  if (!iso) return "";
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

export default class Stage extends View {
  init(_props, cx) {
    this.vm = null;
    this.st = null;
    this.width = 2000;
    this.themeName = THEMES.includes(shared("stage.theme")) ? shared("stage.theme") : "default";
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(80, () => this.handle.focus());
    // macOS natural scrolling (absent key = the default, on): decides which way cmd-scroll zooms.
    this.natural = true;
    exec("defaults", ["read", "-g", "com.apple.swipescrolldirection"]).then((r) => { if (r.code === 0) this.natural = r.stdout.trim() !== "0"; }, () => {});
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        this.input = await gather();
        this.vm = buildStage(this.input);
        if (this.canvas) this.openCanvas(this.canvas.spaceId, this.canvas.cst.sel);
        // Test seam: an isolated Herdr home can hold stage-test.json {"space": name, "sel": addr, "drawer": bool}
        // to open a canvas without key automation. Absent in a real home.
        if (!this.seamRead) {
          this.seamRead = true;
          const seam = JSON.parse((await readTextFile(`${appHome()}/stage-test.json`)) ?? "null");
          const sp = seam && this.input.spaces.find((x) => x.name === seam.space);
          if (THEMES.includes(seam?.theme)) this.themeName = seam.theme;
          if (sp) {
            this.openCanvas(sp.id, seam.sel);
            if (seam.drawer) this.canvas.cst.drawer = true;
            if (typeof seam.zoom === "number") Object.assign(this.canvas.cst, { zoom: seam.zoom, zoomSet: true });
            if (Array.isArray(seam.wheel)) this.seamWheel = seam.wheel; // [{dx, dy, px, py, zoom}] in canvas px
          }
        }
        this.st ??= initial(this.vm);
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  cols() {
    const avail = this.width - 2 * PAD - SLACK - (this.st?.zone === "agents" ? PICKER + GAP : 0);
    return Math.max(1, Math.floor((avail + GAP) / (CARD_MIN + GAP)));
  }

  act(effect) {
    if (!effect) return;
    if (effect.theme) {
      this.themeName = THEMES[(THEMES.indexOf(this.themeName) + 1) % THEMES.length];
      return setShared("stage.theme", this.themeName);
    }
    if (effect.open === "space") return this.openCanvas(effect.space);
    if (effect.back) { this.canvas = null; return; }
    closeOverlay(props().overlay);
    // Helpers have no pane of their own: agent.focus shows them.
    if (effect.open === "agent") effect.pane ? run("pane.focus", { pane: effect.pane }) : run("agent.focus", { terminal: effect.addr });
  }

  // The canvas level: one space as a tree. Keeps the selection across refreshes when it still exists.
  openCanvas(spaceId, keepSel) {
    const sp = this.input?.spaces.find((s) => s.id === spaceId);
    if (!sp) { this.canvas = null; return; }
    // Measured card heights per space and detail level outlive refreshes (and reopening the space).
    this.heights ??= {};
    const heights = (this.heights[spaceId] ??= {});
    const layout = layoutCanvas(sp, "full", heights.full ?? {});
    const sel = keepSel && layout.byId[keepSel] ? keepSel : firstAgent(layout)?.id ?? "root";
    const was = this.canvas?.spaceId === spaceId ? this.canvas.cst : {};
    this.canvas = { spaceId, space: sp, layout, heights, layouts: { full: layout },
      cst: { sel, drawer: was.drawer ?? false, zoom: was.zoom, zoomSet: was.zoomSet ?? false, cam: was.cam ?? null } };
  }

  // Headings: noir draws them in capitals in a condensed face (its stand-in for tracked, glowing caps).
  name(k, s) { return k.caps ? String(s).toUpperCase() : s; }

  // z scales every px on the canvas (1 on the stage): GPUI has no transform, so size is drawn, not scaled.
  glyph(k, r, z = 1) {
    if (r.move) return div().size(18 * z).flex_none().rounded(5 * z).bg(k.move).text_size(12 * z).font_weight(700).text_color(k.onMove).flex().items_center().justify_center().child("!");
    if (r.state === "working") return svg("mods/workspace-chrome/spinner.svg").size(13 * z).flex_none().text_color(k.working).spin(900);
    if (r.state === "done") return div().size(9 * z).flex_none().rounded(5 * z).bg(k.done);
    return div().size(9 * z).flex_none().rounded(5 * z).border(1.5).border_color(k.idle);
  }

  status(k, c) {
    const part = (n, label, color, ring) => h_flex().gap(7).items_center()
      .child(ring ? div().size(9).rounded(5).border(1.5).border_color(color) : div().size(9).rounded(5).bg(color))
      .child(div().text_color(color).child(`${n} ${label}`));
    const parts = [];
    if (c.move) parts.push(part(c.move, "your move", k.move));
    if (c.working) parts.push(part(c.working, "working", k.working));
    if (c.idle) parts.push(part(c.idle, "idle", k.muted, true));
    return h_flex().gap(18).text_size(T.sm).font_weight(600).children(parts.length ? parts : [div().text_color(k.muted).child("nothing running")]);
  }

  row(k, r, on, big) {
    return h_flex().id(`row-${r.addr}`).gap(12).px(10).py(big ? 12 : 8).rounded(10).items_start()
      .when(on, (el) => el.bg(k.selBg).border_l(3).border_color(k.focus))
      .child(h_flex().w(18).flex_none().mt(4).justify_center().child(this.glyph(k, r)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(T.body).text_color(k.ink).child(r.label))
        .when(Boolean(r.move || r.line), (el) => el.child(r.move
          ? div().text_size(T.sm).text_color(k.moveRow).max_h(48).overflow_hidden().child(r.move)
          : div().truncate().text_size(T.sm).text_color(k.muted).child(r.line))))
      .child(div().flex_none().mt(3).text_size(T.cap).text_color(k.muted).child(ago(r.at)));
  }

  card(k, c, i, w) {
    const sel = this.st.card === i && (this.st.zone === "cards" || this.st.zone === "agents");
    return v_flex().id(`card-${c.id}`).w(w).flex_none().px(26).pt(24).pb(22).rounded(18)
      .bg(c.loose ? "#00000000" : k.card2)
      .border(c.loose ? 1.5 : 1).border_color(c.hasMove ? k.moveLine : c.loose ? k.loose : k.border)
      .when(c.hasMove, (el) => el.border_l(4).border_color(k.move))
      .when(sel, (el) => el.border(2).border_color(k.focus).when(k.shadow, (e) => e.shadow_lg()))
      .cursor_pointer()
      .on_click(() => this.act({ open: "space", space: c.id }))
      .child(h_flex().items_center().gap(12)
        .child(div().flex_1().min_w(0).truncate().font_family(k.display).text_size(T.title).font_weight(k.headWeight).text_color(k.head).child(this.name(k, c.name)))
        .when(sel && i < 9, (el) => el.child(div().text_size(T.cap).text_color(k.kbd).px(7).rounded(5).border(1).border_color(k.line).child(String(i + 1)))))
      .child(div().mt(8).truncate().text_size(T.sm).text_color(k.muted).child(c.facts.join("  ·  ")))
      .child(div().mt(14).child(this.status(k, c.counts)))
      .when(c.top.length > 0, (el) => el.child(v_flex().mt(16).pt(12).border_t(1).border_color(k.border).gap(2)
        .children(c.top.map((r) => this.row(k, r, false, false)))))
      .when(c.more > 0, (el) => el.child(div().mt(8).text_size(T.sm).text_color(k.muted).child(`${c.more} more agents · space to pick one`)));
  }

  lane(k) {
    const vm = this.vm;
    if (!vm.lane.length) return null;
    return v_flex().gap(14)
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(T.sub).font_weight(k.caps ? 700 : 600).text_color(k.caps ? k.move : k.ink).child(this.name(k, "Your move")))
        .child(div().px(9).rounded(999).bg(k.move).text_size(T.cap).font_weight(600).text_color(k.onMove).child(String(vm.lane.length))))
      .child(h_flex().id("lane").gap(16).overflow_x_scrollbar()
        .children(vm.lane.map((m, i) => {
          const sel = this.st.zone === "lane" && this.st.lane === i;
          return v_flex().id(`mv-${m.addr}`).w(500).flex_none().px(20).py(18).rounded(14).bg(k.moveBg)
            .border(sel ? 2 : 1).border_color(sel ? k.move : k.moveLine).when(sel && k.shadow, (e) => e.shadow_lg()).cursor_pointer()
            .on_click(() => this.act({ open: "agent", space: m.space, pane: m.pane }))
            .child(div().truncate().text_size(T.cap).text_color(k.moveMeta).child(`${m.spaceName}  ·  ${m.label}`))
            .child(div().mt(6).text_size(T.body).font_weight(500).text_color(k.moveInk).max_h(52).overflow_hidden().child(m.move));
        })));
  }

  picker(k) {
    const c = this.vm.cards[this.st.card];
    return v_flex().w(PICKER).flex_none().px(28).py(26).rounded(18).bg(k.popover).border(1).border_color(k.border)
      .child(div().font_family(k.display).text_size(T.display).font_weight(k.headWeight).text_color(k.head).child(this.name(k, c.name)))
      .child(div().mt(10).child(this.status(k, c.counts)))
      .child(v_flex().id("picker-rows").mt(18).pt(12).border_t(1).border_color(k.border).gap(2).overflow_y_scrollbar()
        .children(c.rows.map((r, i) => this.row(k, r, i === this.st.row, true))))
      .child(div().mt(14).text_size(T.sm).text_color(k.muted).child("↑↓ pick   ↵ open   esc back to cards"));
  }

  // n is already scaled (scaleLayout); z scales the px inside it, and detail drops lines when zoomed out.
  node(k, n, sel, z, detail) {
    const fs = (v) => Math.max(7, v * z);
    if (n.kind === "root") {
      const sp = this.canvas.space;
      return v_flex().absolute().left(n.x).top(n.y).w(n.w).gap(6 * z)
        .child(div().font_family(k.display).text_size(fs(T.display)).font_weight(k.headWeight).text_color(k.head).child(this.name(k, sp.name)))
        .child(div().text_size(fs(T.sm)).text_color(k.muted).child((sp.folder || "").replace(/^\/Users\/[^/]+/, "~")))
        .when(Boolean(sp.git), (el) => el.child(div().text_size(fs(T.sm)).text_color(k.muted).child(`⎇ ${sp.git.branch}`)));
    }
    if (n.kind === "tab") return div().absolute().left(n.x).top(n.y).w(n.w).h(n.h).flex().items_center()
      .text_size(fs(T.sm)).font_weight(k.caps ? 600 : 400).text_color(k.tabInk).child(this.name(k, n.label));
    const r = n.row, full = detail === "full";
    return v_flex().id(`node-${r.addr}`).absolute().left(n.x).top(n.y).w(n.w).px(18 * z).py(14 * z).gap(4 * z).rounded(14 * z).overflow_hidden()
      .bg(sel ? k.card2 : k.card).border(sel ? 2 : 1).border_color(sel ? k.focus : r.move ? k.moveLine : k.border)
      .when(Boolean(r.move), (el) => el.border_l(Math.max(2, 4 * z)).border_color(sel ? k.focus : k.move))
      .when(sel && k.shadow, (el) => el.shadow_lg())
      .on_size_change((size, cx) => this.measured(r.addr, detail, z, size, cx))
      .cursor_pointer().on_click((_e, cx) => { this.canvas.cst.sel = r.addr; this.canvas.cst.cam = null; cx.notify(); })
      .child(h_flex().gap(10 * z).items_center().child(h_flex().w(18 * z).flex_none().justify_center().child(this.glyph(k, r, z)))
        .child(div().flex_1().min_w(0).truncate().text_size(fs(detail === "name" ? T.sub : T.body)).font_weight(600).text_color(k.ink).child(r.label)))
      .when(detail !== "name", (el) => el.child(div().truncate().text_size(fs(T.cap)).text_color(k.muted)
        .child([r.state, ago(r.at), r.tab ? `tab ${r.tab}` : null, full ? r.addr : null].filter(Boolean).join("  ·  "))))
      .when(full && Boolean(r.line), (el) => el.child(div().mt(4 * z).max_h(46 * z).overflow_hidden().text_size(fs(T.sm)).text_color(k.muted).child(r.line)))
      .when(Boolean(r.move), (el) => el.child(div().mt(8 * z).px(12 * z).py(8 * z).rounded(10 * z).bg(k.moveBg).border(1).border_color(k.moveLine).max_h(62 * z).overflow_hidden()
        .text_size(fs(T.sm)).text_color(k.moveInk).child(`Your move: ${r.move}`)));
  }

  drawer(k) {
    const r = this.canvas.layout.byId[this.canvas.cst.sel]?.row;
    if (!r) return null;
    const label = (s) => div().text_size(T.cap).font_weight(600).text_color(k.section).child(s);
    return v_flex().id("drawer").w(700).flex_none().h_full().px(28).py(26).gap(16).bg(k.popover).border_l(1).border_color(k.border).overflow_y_scrollbar()
      .child(div().text_size(T.sub).font_weight(600).text_color(k.ink).child(r.label))
      .child(div().text_size(T.cap).text_color(k.muted).child([this.canvas.space.name, r.tab ? `tab ${r.tab}` : null, r.state, ago(r.at)].filter(Boolean).join("  ·  ")))
      .child(v_flex().gap(10).px(20).py(18).rounded(12).bg(k.inset).border(1).border_color(k.border)
        .child(label("SUMMARY"))
        .child(div().text_size(T.body).text_color(k.ink).child(r.recap || r.line || (r.state === "working" ? "Still working. A summary is made when it stops." : "No message yet.")))
        .child(r.move
          ? div().px(14).py(12).rounded(10).bg(k.moveBg).border(1).border_color(k.moveLine).text_size(T.body).text_color(k.moveInk).child(`Your move: ${r.move}`)
          : div().text_size(T.sm).text_color(k.muted).child("Nothing needed from you.")))
      .when(Boolean(r.text), (el) => el
        .child(label("LAST MESSAGE"))
        .child(div().text_size(T.sm).text_color(k.ink2).child(r.text.replace(/\*\*/g, "").slice(0, 2400))));
  }

  layoutAt(detail) {
    const c = this.canvas;
    c.cur = c.layouts[detail] ??= layoutCanvas(c.space, detail, c.heights[detail] ?? {});
    return c.cur;
  }

  // A card reports its drawn height; a real change re-lays out that detail level (and the fit, for "full").
  measured(addr, detail, z, size, cx) {
    const c = this.canvas; if (!c) return;
    const h = size.height / (Number(settings().zoom) || 1) / z;
    const next = measure(c.heights[detail] ?? {}, addr, h);
    if (!next) return;
    c.heights[detail] = next;
    delete c.layouts[detail];
    if (detail === "full") c.layout = c.layouts.full = layoutCanvas(c.space, "full", next);
    cx.notify();
  }

  // Two-finger scroll / wheel pans; with cmd or ctrl it zooms about the pointer. GPUI reports zoomed px.
  wheel(e, cx) {
    const c = this.canvas; if (!c || !this.shownCam) return;
    const az = Number(settings().zoom) || 1;
    const lines = !e.delta.x && !e.delta.y && e.delta_lines;
    const dx = (lines ? e.delta_lines.x * 40 : e.delta.x) / (lines ? 1 : az), dy = (lines ? e.delta_lines.y * 40 : e.delta.y) / (lines ? 1 : az);
    const pos = e.local_position ?? (e.bounds ? { x: e.position.x - e.bounds.x, y: e.position.y - e.bounds.y } : e.position);
    const zoom = Boolean(e.modifiers?.platform || e.modifiers?.control);
    c.cst = wheelCanvas(c.cst, { dx, dy, px: pos.x / az, py: pos.y / az, zoom, natural: this.natural }, c.cur ?? c.layout, this.view, this.shownCam);
    cx.stop_propagation(); cx.notify();
  }

  // Zoom buttons, bottom left of the canvas: the same keys the keyboard sends.
  zoomBar(k, z) {
    const key = (label, k2, w) => div().id(`zoom-${label}`).px(12).py(7).min_w(w ?? 0).flex().justify_center().text_size(T.cap).text_color(k.ink2).cursor_pointer().child(label)
      .on_click((_e, cx) => { if (!k2) return; const r = nextCanvas(this.canvas.cst, k2, this.canvas.cur ?? this.canvas.layout, this.view); this.canvas.cst = r.state; cx.notify(); });
    return h_flex().absolute().left(24).bottom(24).rounded(10).border(1).border_color(k.line).bg(k.popover).overflow_hidden()
      .child(key("−", "-"))
      .child(div().w(1).h_full().bg(k.line)).child(key(`${Math.round(z * 100)}%`, null, 64))
      .child(div().w(1).h_full().bg(k.line)).child(key("+", "="))
      .child(div().w(1).h_full().bg(k.line)).child(key("0 fit", "0"));
  }

  bar(k) {
    return h_flex().px(PAD).pt(26).pb(18).items_center().gap(16).bg(k.bar).border_b(1).border_color(k.border);
  }

  renderCanvas(k, root) {
    const c = this.canvas, drawerW = c.cst.drawer ? 700 : 0;
    const vw = this.width - drawerW, vh = (this.height || 1000) - 80;
    this.view = { vw, vh };
    this.view.fit = zoomOf({ zoomSet: false }, c.layout, this.view);
    if (this.seamWheel) {
      const evs = this.seamWheel; this.seamWheel = null;
      for (const ev of evs) {
        const z0 = zoomOf(c.cst, c.layout, this.view), L0 = this.layoutAt(detailAt(z0));
        c.cst = wheelCanvas(c.cst, ev, L0, this.view, c.cst.cam ?? camera(scaleLayout(L0, z0), c.cst.sel, vw, vh));
      }
    }
    // The fit zoom comes from the full layout; the drawn (and navigated) layout is the one sized for that
    // zoom's detail, so zoomed-out cards shrink with what they show.
    const z = zoomOf(c.cst, c.layout, this.view), detail = detailAt(z);
    const L = this.layoutAt(detail), S = scaleLayout(L, z);
    const cam = c.cst.cam ?? camera(S, c.cst.sel, vw, vh);
    this.shownCam = cam;
    const moves = L.nodes.filter((n) => n.row?.move).length, agentsN = L.nodes.filter((n) => n.kind === "agent").length;
    const ew = Math.max(1, 2 * z);
    const world = div().absolute().left(cam.x).top(cam.y)
      .children(edgeSegments(S).map((g) => div().absolute().left(g.x).top(g.y).w(Math.max(g.w, ew)).h(Math.max(g.h, ew)).bg(g.hot ? k.move : k.edge)))
      .children(S.nodes.map((n) => this.node(k, n, n.id === c.cst.sel, z, detail)));
    return root
      .child(this.bar(k)
        .child(div().text_size(T.sub).text_color(k.muted).child(this.name(k, "Stage  /")))
        .child(div().font_family(k.display).text_size(T.sub).font_weight(700).text_color(k.crumb).child(this.name(k, c.space.name)))
        .child(div().text_size(T.sm).text_color(k.muted).child([c.space.git ? `⎇ ${c.space.git.branch}` : "no repo yet", `${agentsN} agents`].join("  ·  ")))
        .child(div().flex_1())
        .when(moves > 0, (el) => el.child(div().text_size(T.sm).font_weight(600).text_color(k.move).child(`● ${moves} waiting on you`)))
        .child(div().text_size(T.cap).text_color(k.kbd).child("←↑↓→ move · n next ask · space recap · + − 0 or ⌘-scroll zoom · scroll pan · t theme · ↵ open · esc stage")))
      .child(h_flex().flex_1().min_h(0)
        .child(div().id("canvas").relative().flex_1().h_full().overflow_hidden().on_scroll_wheel((e, cx) => this.wheel(e, cx)).child(world).child(this.zoomBar(k, z)))
        .when(c.cst.drawer, (el) => el.child(this.drawer(k))));
  }

  render(cx) {
    const k = tokens(theme(), this.themeName);
    const root = v_flex().id("stage").track_focus(this.handle).size_full().bg(k.bg).text_color(k.ink)
      .when(Boolean(k.sans), (el) => el.font_family(k.sans))
      // Sizes arrive multiplied by the app's zoom; layout math is in the mod's own px.
      .on_size_change((size, cx) => { const z = Number(settings().zoom) || 1, w = size.width / z; this.height = size.height / z; if (Math.abs(w - this.width) > 4) { this.width = w; cx.notify(); } })
      .on_key_down((e, cx) => {
        if (!this.vm) return;
        const key = e.key === "tab" && e.modifiers?.shift ? "tab" : e.key;
        if (e.modifiers?.platform || e.modifiers?.control) return; // cmd-= etc. stay the app's
        if (this.canvas) {
          const r = nextCanvas(this.canvas.cst, key, this.canvas.cur ?? this.canvas.layout, this.view);
          this.canvas.cst = r.state; this.act(r.effect);
        } else {
          const r = next(this.st, key, this.vm, this.cols());
          this.st = r.state; this.act(r.effect);
        }
        cx.stop_propagation(); cx.notify();
      });
    if (this.error) return root.p(PAD).child(div().text_size(T.body).text_color(k.blocked).child(`Stage couldn't load: ${this.error}`));
    if (!this.vm) return root.p(PAD).child(div().text_size(T.body).text_color(k.muted).child("Gathering spaces and agents…"));
    if (this.canvas) return this.renderCanvas(k, root);
    const vm = this.vm, cols = this.cols();
    const avail = this.width - 2 * PAD - SLACK - (this.st.zone === "agents" ? PICKER + GAP : 0);
    const w = Math.floor((avail - GAP * (cols - 1)) / cols);
    const grid = (cards, offset) => h_flex().flex_wrap().gap(GAP).items_start().children(cards.map((c, i) => this.card(k, c, offset + i, w)));
    const placed = vm.cards.slice(0, vm.placed), loose = vm.cards.slice(vm.placed);
    return root
      .child(this.bar(k)
        .child(div().font_family(k.display).text_size(T.sub).font_weight(700).text_color(k.crumb).child(this.name(k, "Stage")))
        .child(div().text_size(T.sm).text_color(k.muted).child(`${vm.placed} spaces  ·  ${vm.cards.length - vm.placed} without a space`))
        .child(div().flex_1())
        .when(vm.lane.length > 0, (el) => el.child(div().text_size(T.sm).font_weight(600).text_color(k.move).child(`● ${vm.lane.length} waiting on you`)))
        .child(div().text_size(T.cap).text_color(k.kbd).child("←↑↓→ move · tab lane · space agents · t theme · ↵ open · esc close")))
      .child(h_flex().flex_1().min_h(0).items_start().gap(GAP).px(PAD).pt(20)
        .child(v_flex().id("stage-scroll").flex_1().min_w(0).h_full().gap(48).pb(40).overflow_y_scrollbar()
          .when(Boolean(this.lane(k)), (el) => el.child(this.lane(k)))
          .child(grid(placed, 0))
          .when(loose.length > 0, (el) => el.child(v_flex().gap(14)
            .child(div().text_size(T.sm).font_weight(600).text_color(k.section).child(this.name(k, "No space yet")))
            .child(grid(loose, vm.placed)))))
        .when(this.st.zone === "agents", (el) => el.child(this.picker(k))));
  }
}
