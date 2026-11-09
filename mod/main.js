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
const T = { cap: 12, sm: 13, body: 15 };
const CARD_MIN = 260, CARD_H = 156, GAP = 10, PAD = 10, SLACK = 14; // SLACK: room for the scrollbar
const ROW_H = CARD_H + GAP;

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

  counts(k, c, live) {
    const parts = [];
    if (c?.counts.move) parts.push(div().text_color(k.move).font_weight(600).child(`${c.counts.move} your move`));
    if (c?.counts.working) parts.push(div().text_color(k.working).child(`${c.counts.working} working`));
    if (c?.counts.idle) parts.push(div().child(`${c.counts.idle} idle`));
    if (!parts.length) parts.push(div().child(c ? "nothing running" : live.status ?? ""));
    const sep = () => div().child("·");
    return h_flex().gap(6).text_size(T.cap).text_color(k.muted).children(parts.flatMap((p, i) => (i ? [sep(), p] : [p])));
  }

  dot(k, c, live) {
    const color = c?.counts.move ? k.move : c?.counts.working || live.status === "working" ? k.working
      : live.status === "blocked" ? k.blocked : live.status === "done" ? k.done : null;
    return color ? div().size(8).flex_none().rounded(4).bg(color) : div().size(8).flex_none().rounded(4).border(1).border_color(k.idle);
  }

  // One agent line on a card: its state colour, its label, and what it is doing or asking.
  agent(k, r) {
    const color = r.move ? k.move : r.state === "working" ? k.working : k.idle;
    return h_flex().gap(6).items_center().min_w(0).text_size(T.cap)
      .child(div().size(5).flex_none().rounded(3).bg(color))
      .child(div().flex_none().max_w(110).truncate().text_color(k.ink2).child(r.label))
      .child(div().flex_1().min_w(0).truncate().text_color(r.move ? k.moveRow : k.muted).child(r.move ?? r.line ?? ""));
  }

  card(k, live, i, w) {
    const c = this.byId[live.id], on = i === this.sel;
    const branch = live.branch ?? (c?.facts.find((f) => f.startsWith("⎇")) ?? "").replace("⎇ ", "");
    const folder = c?.facts[0] ?? "";
    const top = (c?.top ?? []).slice(0, 2);
    return v_flex().w(w).h(CARD_H).flex_none().px(14).py(12).gap(6).rounded(10).overflow_hidden()
      .bg(on ? k.selBg : k.card ?? k.bg)
      .border(on ? 2 : 1).border_color(on ? k.focus : c?.hasMove ? k.moveLine ?? k.move : k.border)
      .when(Boolean(c?.hasMove) && !on, (el) => el.border_l(3).border_color(k.move))
      .child(h_flex().gap(8).items_center()
        .child(this.dot(k, c, live))
        .child(div().flex_1().min_w(0).truncate().text_size(T.body).font_weight(live.active ? 700 : 600).text_color(k.ink).child(live.name))
        .when(live.active, (el) => el.child(div().flex_none().text_size(T.cap).text_color(k.focus).child("here"))))
      .child(div().truncate().text_size(T.cap).text_color(k.muted).child([folder, branch && `⎇ ${branch}`].filter(Boolean).join("  ·  ")))
      .child(this.counts(k, c, live))
      .when(top.length > 0, (el) => el.child(v_flex().mt(2).pt(6).gap(4).border_t(1).border_color(k.border).min_w(0)
        .children(top.map((r) => this.agent(k, r)))))
      .when((c?.rows.length ?? 0) > top.length, (el) => el.child(div().text_size(T.cap).text_color(k.idle).child(`+${c.rows.length - top.length} more`)));
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
    const header = h_flex().px(16).py(12).gap(8).items_center().border_b(1).border_color(k.border)
      .child(div().text_size(T.body).font_weight(700).text_color(k.ink).child("Stage"))
      .child(div().text_size(T.cap).text_color(k.muted).child(`${list.length} spaces`))
      .child(div().flex_1())
      .when(this.lane > 0, (el) => el.child(div().text_size(T.cap).font_weight(600).text_color(k.move).child(`${this.lane} waiting on you`)));
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
    const foot = div().px(16).py(8).border_t(1).border_color(k.border).text_size(T.cap).text_color(k.muted)
      .child(this.error ? `Couldn't read agents: ${this.error}` : !this.loaded ? "Reading agents…" : "h j k l move · ↵ go to space · q close");
    return root.child(header).child(body).child(foot);
  }
}
