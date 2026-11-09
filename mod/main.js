// Stage, as a side pane: every space as a card in a grid, h j k l to move, Enter to go there.
// Opened with pane.split {mod: "stage"} (cmd-g in keys.json). Focusable like herdr-md: pane.go moves the
// keyboard in and out. The old full-window popup (canvas, zoom) lives on in ./dialog.js, not installed.
//
// Data: names, order and the shown space come live from spaces(); counts and asks from ./adapter.js
// (git and transcript reads), refreshed every 10s while the pane is open.
//
// The grid is a virtual list of rows, because that is the one scroll area code can scroll (to keep the
// selected card on screen). Its renderer may hold no handlers and must state row heights, so cards are a
// fixed height and clicks come through the list (row key) plus a mouse-down on the wrapper (column).

import { View, div } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { theme, run, spaces, panes, focused, nextCommand, settings } from "herdr";
import { gather } from "./adapter.js";
import { buildStage } from "./core/stage.js";
import { nextGrid, colsFor, rowOf, rowsFor } from "./core/grid.js";
import { tokens } from "./themes.js";

const MOD = "stage";
const T = { tiny: 11, cap: 12, sm: 13, body: 15, name: 20 };
const CARD_MIN = 270, CARD_H = 184, GAP = 14, PAD = 14, SLACK = 14; // SLACK: room for the scrollbar
const ROW_H = CARD_H + GAP;

function ago(iso) {
  if (!iso) return "";
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

// A #rrggbb colour at some alpha (0-255), or the fallback when the theme gave another form.
const tint = (c, a, fallback) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c + a.toString(16).padStart(2, "0") : fallback);

export default class Stage extends View {
  init(_props, cx) {
    this.sel = 0;
    this.byId = {};
    this.lane = 0;
    this.width = 320;
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(60, () => this.handle.focus());
    // cmd-g in a tab that already shows a stage: this new copy hands focus to that one and closes itself.
    cx.timer.after(40, () => {
      const tab = focused()?.tab, mine = panes().filter((p) => p.mod === MOD && p.tab === tab);
      const me = mine.find((p) => p.focused), other = mine.find((p) => !p.focused);
      if (me && other) { run("pane.focus", { pane: other.pane }); run("pane.close", { pane: me.pane }); }
    });
    // "focus" arrives when pane.go lands here, and when a popup over the pane closes: take the keyboard
    // only if this pane is still the focused one a moment later (the herdr-md rule).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c !== "focus") continue;
        cx.timer.after(60, () => { if (panes().find((p) => p.focused)?.mod === MOD) this.handle.focus(); });
      }
    });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const vm = buildStage(await gather());
        this.byId = Object.fromEntries(vm.cards.map((c) => [c.id, c]));
        this.lane = vm.lane.length;
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loading = false;
      this.loaded = true;
      cx.notify();
    });
  }

  go(sp) { if (sp) run("space.select", { id: sp.id }); }

  cols() { return colsFor(this.width - 2 * PAD, CARD_MIN, GAP, SLACK); }

  cardW(cols) { return Math.floor((this.width - 2 * PAD - SLACK - GAP * (cols - 1)) / cols); }

  // "2 your move  ·  1 working  ·  ○ 3 idle", each with its own coloured dot (the POC's status line).
  counts(k, c, live) {
    const part = (n, label, color, ring) => h_flex().gap(5).items_center()
      .child(ring ? div().size(7).rounded(4).border(1).border_color(color) : div().size(7).rounded(4).bg(color))
      .child(div().text_color(color).child(`${n} ${label}`));
    const parts = [];
    if (c?.counts.move) parts.push(part(c.counts.move, "your move", k.move));
    if (c?.counts.working) parts.push(part(c.counts.working, "working", k.working));
    if (c?.counts.idle) parts.push(part(c.counts.idle, "idle", k.muted, true));
    if (!parts.length) parts.push(div().text_color(k.idle).child(c ? "nothing running" : live.status ?? ""));
    return h_flex().gap(12).text_size(T.cap).font_weight(600).children(parts);
  }

  // An agent's state as a glyph: an orange "!" when it needs you, a dot otherwise.
  glyph(k, r) {
    if (r.move) return div().size(14).flex_none().rounded(4).bg(k.move).text_size(10).font_weight(800).text_color(k.onMove)
      .flex().items_center().justify_center().child("!");
    const color = r.state === "working" ? k.working : r.state === "done" ? k.done : null;
    return h_flex().w(14).flex_none().justify_center()
      .child(color ? div().size(7).rounded(4).bg(color) : div().size(7).rounded(4).border(1).border_color(k.idle));
  }

  // One agent on a card: label and age on top, its ask (orange) or what it's doing underneath.
  agent(k, r) {
    const sub = r.move ?? r.line;
    return h_flex().gap(8).items_start().min_w(0)
      .child(div().mt(2).child(this.glyph(k, r)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().gap(8).min_w(0)
          .child(div().flex_1().min_w(0).truncate().text_size(T.sm).text_color(k.ink).child(r.label))
          .child(div().flex_none().text_size(T.tiny).text_color(k.idle).child(ago(r.at))))
        .when(Boolean(sub), (el) => el.child(div().truncate().text_size(T.cap).text_color(r.move ? k.moveRow : k.muted).child(sub))));
  }

  card(k, live, i, w) {
    const c = this.byId[live.id], on = i === this.sel, move = Boolean(c?.hasMove);
    const branch = live.branch ?? (c?.facts.find((f) => f.startsWith("⎇")) ?? "").replace("⎇ ", "");
    const folder = c?.facts[0] ?? "";
    const top = (c?.top ?? []).slice(0, 2), more = (c?.rows.length ?? 0) - top.length;
    return v_flex().w(w).h(CARD_H).flex_none().px(16).pt(14).pb(12).rounded(14).overflow_hidden().relative()
      // A faint lit top edge: on a near-black pane a shadow alone barely reads, so the card catches light.
      .child(div().absolute().top(0).left(14).right(14).h(1).bg(on ? tint(k.focus, 0x66, k.line) : "#ffffff14"))
      .bg(on ? k.card2 : k.card).when(Boolean(c?.loose), (el) => el.bg(k.bg).border_dashed())
      .border(on ? 2 : 1).border_color(on ? k.focus : move ? k.moveLine : k.line)
      .when(on, (el) => el.shadow_xl()).when(!on, (el) => el.shadow_md())
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().font_family(k.display).text_size(T.name).font_weight(k.headWeight).text_color(k.head)
          .child(k.caps ? live.name.toUpperCase() : live.name))
        .when(live.active, (el) => el.child(div().flex_none().px(7).py(1).rounded(999).bg(tint(k.focus, 0x26, k.selBg)).text_size(T.tiny).font_weight(700).text_color(k.focus).child("HERE"))))
      .child(div().mt(3).truncate().text_size(T.cap).text_color(k.muted).child([folder, branch && `⎇ ${branch}`].filter(Boolean).join("  ·  ")))
      .child(div().mt(8).child(this.counts(k, c, live)))
      .when(top.length > 0, (el) => el.child(v_flex().mt(10).pt(10).gap(8).border_t(1).border_color(k.border).min_w(0)
        .children(top.map((r) => this.agent(k, r)))))
      .child(div().flex_1())
      .when(more > 0, (el) => el.child(div().text_size(T.tiny).text_color(k.idle).child(`${more} more agent${more > 1 ? "s" : ""}`)));
  }

  key(e, list, cx) {
    if (e.modifiers?.platform || e.modifiers?.control) return; // cmd-h/l etc. stay the app's
    const cols = this.cols(), before = this.sel;
    const r = nextGrid(this.sel, e.key, list.length, cols, Boolean(e.modifiers?.shift));
    this.sel = r.sel;
    if (this.sel !== before) this.scroll.scroll_to_item(rowOf(this.sel, cols));
    if (r.effect?.open !== undefined) this.go(list[r.effect.open]);
    if (r.effect?.close) { const me = panes().find((p) => p.focused && p.mod === MOD); if (me) run("pane.close", { pane: me.pane }); }
    cx.stop_propagation(); cx.notify();
  }

  // A click: the wrapper's mouse-down gives the column, the list's item click gives the row.
  click(rowKey, list, cx) {
    const cols = this.cols(), w = this.cardW(cols);
    const col = Math.max(0, Math.min(cols - 1, Math.floor((this.downX - PAD) / (w + GAP))));
    const i = Number(rowKey) * cols + col;
    if (i < list.length) this.sel = i;
    this.handle.focus();
    cx.notify();
  }

  render(cx) {
    const k = tokens(theme(), "default");
    const list = spaces();
    if (this.sel > list.length - 1) this.sel = Math.max(0, list.length - 1);
    const cols = this.cols(), w = this.cardW(cols), nRows = rowsFor(list.length, cols);
    const root = v_flex().id("stage").track_focus(this.handle).size_full().bg(k.bg).text_color(k.ink)
      // Sizes arrive multiplied by the app's zoom; layout math is in the mod's own px.
      .on_size_change((size, cx) => {
        const z = Number(settings().zoom) || 1, nw = size.width / z;
        if (Math.abs(nw - this.width) > 2) { this.width = nw; cx.notify(); }
      })
      .on_key_down((e, cx) => this.key(e, list, cx));
    const header = h_flex().px(18).pt(16).pb(12).gap(10).items_end()
      .child(div().font_family(k.display).text_size(T.name + 2).font_weight(k.headWeight).text_color(k.head).child(k.caps ? "STAGE" : "Stage"))
      .child(div().pb(2).text_size(T.cap).text_color(k.muted).child(`${list.length} spaces`))
      .child(div().flex_1())
      .when(this.lane > 0, (el) => el.child(h_flex().mb(1).gap(6).items_center().px(9).py(3).rounded(999).bg(tint(k.move, 0x22, k.moveBg))
        .child(div().size(6).rounded(3).bg(k.move))
        .child(div().text_size(T.cap).font_weight(700).text_color(k.move).child(`${this.lane} waiting on you`))));
    const grid = v_virtual_list("stage-grid", nRows, ROW_H, (r) => String(r), (range) => {
      const out = [];
      for (let r = range.start; r < range.end; r++) {
        const cards = [];
        for (let i = r * cols; i < Math.min(list.length, (r + 1) * cols); i++) cards.push(this.card(k, list[i], i, w));
        out.push(h_flex().h(ROW_H).px(PAD).gap(GAP).items_start().children(cards));
      }
      return out;
    }).track_scroll(this.scroll).size_full()
      .on_item_click((rowKey, cx) => this.click(rowKey, list, cx));
    const body = div().relative().flex_1().min_h(0).w_full().pt(PAD)
      .on_mouse_down("left", (e) => { const z = Number(settings().zoom) || 1; this.downX = (e.local_position?.x ?? e.position?.x ?? 0) / z; })
      .child(grid)
      .child(Scrollbar.vertical("stage-grid").absolute().inset_0());
    const foot = div().px(18).py(8).border_t(1).border_color(k.border).text_size(T.tiny).text_color(k.idle)
      .child(this.error ? `Couldn't read agents: ${this.error}` : !this.loaded ? "Reading agents…" : "h j k l move · ↵ go to space · q close");
    return root.child(header).child(body).child(foot);
  }
}
