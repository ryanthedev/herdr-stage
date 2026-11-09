// Stage, as a side pane: every space, one row each, with what it needs from you.
// Opened with pane.split {mod: "stage"} (cmd-g in keys.json). Focusable like herdr-md: pane.go moves the
// keyboard in and out. The old full-window popup (cards, canvas) lives on in ./dialog.js, not installed.
//
// Data: names, order and the shown space come live from spaces(); counts and asks from ./adapter.js
// (git and transcript reads), refreshed every 10s while the pane is open.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, run, spaces, panes, focused, nextCommand } from "herdr";
import { gather } from "./adapter.js";
import { buildStage } from "./core/stage.js";
import { nextList } from "./core/list.js";
import { tokens } from "./themes.js";

const MOD = "stage";
const T = { cap: 12, sm: 13, body: 14 };

export default class Stage extends View {
  init(_props, cx) {
    this.sel = 0;
    this.byId = {};
    this.lane = 0;
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
    return color ? div().size(7).flex_none().rounded(4).bg(color) : div().size(7).flex_none().rounded(4).border(1).border_color(k.idle);
  }

  row(k, live, i) {
    const c = this.byId[live.id], on = i === this.sel;
    const ask = c?.rows.find((r) => r.move);
    const branch = live.branch ?? (c?.facts.find((f) => f.startsWith("⎇")) ?? "").replace("⎇ ", "");
    return v_flex().id(`space-${live.id}`).px(12).py(9).gap(3).rounded(6).cursor_pointer()
      .border_l(2).border_color(on ? k.focus : "#00000000")
      .when(on, (el) => el.bg(k.selBg))
      .on_mouse_down("left", (_e, cx) => { this.sel = i; this.handle.focus(); cx.notify(); })
      .on_click((e) => { if (e.click_count === 2) this.go(live); })
      .child(h_flex().gap(8).items_center()
        .child(this.dot(k, c, live))
        .child(div().flex_1().min_w(0).truncate().text_size(T.body).font_weight(live.active ? 700 : 500).text_color(k.ink).child(live.name))
        .when(live.active, (el) => el.child(div().flex_none().text_size(T.cap).text_color(k.focus).child("here")))
        .when(Boolean(branch), (el) => el.child(div().flex_none().max_w(140).truncate().text_size(T.cap).text_color(k.muted).child(branch))))
      .child(div().pl(15).child(this.counts(k, c, live)))
      .when(Boolean(ask), (el) => el.child(div().pl(15).max_h(36).overflow_hidden().text_size(T.sm).text_color(k.moveRow).child(ask.move)));
  }

  render(cx) {
    const k = tokens(theme(), "default");
    const list = spaces();
    if (this.sel > list.length - 1) this.sel = Math.max(0, list.length - 1);
    const root = v_flex().id("stage").track_focus(this.handle).size_full().bg(k.bg).text_color(k.ink)
      .on_key_down((e, cx) => {
        if (e.modifiers?.platform || e.modifiers?.control) return; // cmd-h/l etc. stay the app's
        const r = nextList(this.sel, e.key, list.length, Boolean(e.modifiers?.shift));
        this.sel = r.sel;
        if (r.effect?.open !== undefined) this.go(list[r.effect.open]);
        if (r.effect?.close) { const me = panes().find((p) => p.focused && p.mod === MOD); if (me) run("pane.close", { pane: me.pane }); }
        cx.stop_propagation(); cx.notify();
      });
    const header = h_flex().px(16).py(12).gap(8).items_center().border_b(1).border_color(k.border)
      .child(div().text_size(T.body).font_weight(700).text_color(k.ink).child("Stage"))
      .child(div().text_size(T.cap).text_color(k.muted).child(`${list.length} spaces`))
      .child(div().flex_1())
      .when(this.lane > 0, (el) => el.child(div().text_size(T.cap).font_weight(600).text_color(k.move).child(`${this.lane} waiting on you`)));
    const body = v_flex().id("stage-list").flex_1().min_h(0).px(6).py(6).gap(2).overflow_y_scrollbar()
      .children(list.map((sp, i) => this.row(k, sp, i)));
    const foot = div().px(16).py(8).border_t(1).border_color(k.border).text_size(T.cap).text_color(k.muted)
      .child(this.error ? `Couldn't read agents: ${this.error}` : !this.loaded ? "Reading agents…" : "j k move · ↵ go to space · q close");
    return root.child(header).child(body).child(foot);
  }
}
