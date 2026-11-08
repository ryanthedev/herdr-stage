// Stage: every space as a card, what each agent needs from you, and a lane of "your move" items.
// Opened with mod.open:stage (keys.json); a full-window dialog over the work.
//
// Hexagonal: data comes in through ./adapter.js, the view-model and keyboard behaviour come from ./core
// (shared with the browser POC and the tests); this file only draws and forwards keys.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, run, props, closeOverlay, settings } from "herdr";
import { gather } from "./adapter.js";
import { buildStage } from "./core/stage.js";
import { next, initial } from "./core/nav.js";

// Six sizes on an 18px base: the whole type scale.
const T = { cap: 14, sm: 16, body: 18, sub: 22, title: 30, display: 38 };
const MOVE = "#ff9f43", MOVE_INK = "#ffe2c2", MOVE_BG = "#22170c", MOVE_LINE = "#5a3a19";
const SERIF = "New York";
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
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(80, () => this.handle.focus());
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        this.vm = buildStage(await gather());
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
    closeOverlay(props().overlay);
    if (effect.open === "agent") run("pane.focus", { pane: effect.pane });
    else if (effect.open === "space") run("space.select", { id: effect.space });
  }

  glyph(t, r) {
    if (r.move) return div().size(18).flex_none().rounded(5).bg(MOVE).text_size(12).font_weight(700).text_color("#000").flex().items_center().justify_center().child("!");
    if (r.state === "working") return svg("mods/workspace-chrome/spinner.svg").size(13).flex_none().text_color(t.working).spin(900);
    if (r.state === "done") return div().size(9).flex_none().rounded(5).bg(t.done);
    return div().size(9).flex_none().rounded(5).border(1.5).border_color(t.idle ?? t.dim);
  }

  status(t, c) {
    const part = (n, label, color, ring) => h_flex().gap(7).items_center()
      .child(ring ? div().size(9).rounded(5).border(1.5).border_color(color) : div().size(9).rounded(5).bg(color))
      .child(div().text_color(color).child(`${n} ${label}`));
    const parts = [];
    if (c.move) parts.push(part(c.move, "your move", MOVE));
    if (c.working) parts.push(part(c.working, "working", t.working));
    if (c.idle) parts.push(part(c.idle, "idle", t.muted, true));
    return h_flex().gap(18).text_size(T.sm).font_weight(600).children(parts.length ? parts : [div().text_color(t.muted).child("nothing running")]);
  }

  row(t, r, on, big) {
    return h_flex().id(`row-${r.addr}`).gap(12).px(10).py(big ? 12 : 8).rounded(10).items_start()
      .when(on, (el) => el.bg(t.selected).border_l(3).border_color(t.accent))
      .child(h_flex().w(18).flex_none().mt(4).justify_center().child(this.glyph(t, r)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(T.body).text_color(t.foreground).child(r.label))
        .when(Boolean(r.move || r.line), (el) => el.child(r.move
          ? div().text_size(T.sm).text_color(MOVE).max_h(48).overflow_hidden().child(r.move)
          : div().truncate().text_size(T.sm).text_color(t.muted).child(r.line))))
      .child(div().flex_none().mt(3).text_size(T.cap).text_color(t.muted).child(ago(r.at)));
  }

  card(t, c, i, w) {
    const sel = this.st.card === i && (this.st.zone === "cards" || this.st.zone === "agents");
    return v_flex().id(`card-${c.id}`).w(w).flex_none().px(26).pt(24).pb(22).rounded(18)
      .bg(c.loose ? "#00000000" : t.raised ?? "#1a1d23")
      .border(c.loose ? 1.5 : 1).border_color(c.hasMove ? MOVE_LINE : t.border)
      .when(c.hasMove, (el) => el.border_l(4).border_color(MOVE))
      .when(sel, (el) => el.border(2).border_color(t.accent))
      .cursor_pointer()
      .on_click(() => this.act({ open: "space", space: c.id }))
      .child(h_flex().items_center().gap(12)
        .child(div().flex_1().min_w(0).truncate().font_family(SERIF).text_size(T.title).font_weight(600).text_color(t.foreground).child(c.name))
        .when(sel && i < 9, (el) => el.child(div().text_size(T.cap).text_color(t.muted).px(7).rounded(5).border(1).border_color(t.border).child(String(i + 1)))))
      .child(div().mt(8).truncate().text_size(T.sm).text_color(t.muted).child(c.facts.join("  ·  ")))
      .child(div().mt(14).child(this.status(t, c.counts)))
      .when(c.top.length > 0, (el) => el.child(v_flex().mt(16).pt(12).border_t(1).border_color(t.border).gap(2)
        .children(c.top.map((r) => this.row(t, r, false, false)))))
      .when(c.more > 0, (el) => el.child(div().mt(8).text_size(T.sm).text_color(t.muted).child(`${c.more} more agents · space to pick one`)));
  }

  lane(t) {
    const vm = this.vm;
    if (!vm.lane.length) return null;
    return v_flex().gap(14)
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(T.sub).font_weight(600).text_color(t.foreground).child("Your move"))
        .child(div().px(9).rounded(999).bg(MOVE).text_size(T.cap).font_weight(600).text_color("#000").child(String(vm.lane.length))))
      .child(h_flex().id("lane").gap(16).overflow_x_scrollbar()
        .children(vm.lane.map((m, i) => {
          const sel = this.st.zone === "lane" && this.st.lane === i;
          return v_flex().id(`mv-${m.addr}`).w(500).flex_none().px(20).py(18).rounded(14).bg(MOVE_BG)
            .border(sel ? 2 : 1).border_color(sel ? MOVE : MOVE_LINE).cursor_pointer()
            .on_click(() => this.act({ open: "agent", space: m.space, pane: m.pane }))
            .child(div().truncate().text_size(T.cap).text_color("#c69a6c").child(`${m.spaceName}  ·  ${m.label}`))
            .child(div().mt(6).text_size(T.body).font_weight(500).text_color(MOVE_INK).max_h(52).overflow_hidden().child(m.move));
        })));
  }

  picker(t) {
    const c = this.vm.cards[this.st.card];
    return v_flex().w(PICKER).flex_none().px(28).py(26).rounded(18).bg(t.popover).border(1).border_color(t.border)
      .child(div().font_family(SERIF).text_size(T.display).font_weight(600).text_color(t.foreground).child(c.name))
      .child(div().mt(10).child(this.status(t, c.counts)))
      .child(v_flex().id("picker-rows").mt(18).pt(12).border_t(1).border_color(t.border).gap(2).overflow_y_scrollbar()
        .children(c.rows.map((r, i) => this.row(t, r, i === this.st.row, true))))
      .child(div().mt(14).text_size(T.sm).text_color(t.muted).child("↑↓ pick   ↵ open   esc back to cards"));
  }

  render(cx) {
    const t = theme();
    const root = v_flex().id("stage").track_focus(this.handle).size_full().bg(t.background).text_color(t.foreground)
      // Sizes arrive multiplied by the app's zoom; layout math is in the mod's own px.
      .on_size_change((size, cx) => { const w = size.width / (Number(settings().zoom) || 1); if (Math.abs(w - this.width) > 4) { this.width = w; cx.notify(); } })
      .on_key_down((e, cx) => {
        if (!this.vm) return;
        const k = e.key === "tab" && e.modifiers?.shift ? "tab" : e.key;
        const r = next(this.st, k, this.vm, this.cols());
        this.st = r.state; this.act(r.effect);
        cx.stop_propagation(); cx.notify();
      });
    if (this.error) return root.p(PAD).child(div().text_size(T.body).text_color(t.blocked).child(`Stage couldn't load: ${this.error}`));
    if (!this.vm) return root.p(PAD).child(div().text_size(T.body).text_color(t.muted).child("Gathering spaces and agents…"));
    const vm = this.vm, cols = this.cols();
    const avail = this.width - 2 * PAD - SLACK - (this.st.zone === "agents" ? PICKER + GAP : 0);
    const w = Math.floor((avail - GAP * (cols - 1)) / cols);
    const grid = (cards, offset) => h_flex().flex_wrap().gap(GAP).items_start().children(cards.map((c, i) => this.card(t, c, offset + i, w)));
    const placed = vm.cards.slice(0, vm.placed), loose = vm.cards.slice(vm.placed);
    return root
      .child(h_flex().px(PAD).pt(26).pb(18).items_center().gap(16).border_b(1).border_color(t.border)
        .child(div().text_size(T.sub).font_weight(700).child("Stage"))
        .child(div().text_size(T.sm).text_color(t.muted).child(`${vm.placed} spaces  ·  ${vm.cards.length - vm.placed} without a space`))
        .child(div().flex_1())
        .when(vm.lane.length > 0, (el) => el.child(div().text_size(T.sm).font_weight(600).text_color(MOVE).child(`● ${vm.lane.length} waiting on you`)))
        .child(div().text_size(T.cap).text_color(t.muted).child("←↑↓→ move · tab lane · space agents · ↵ open · esc close")))
      .child(h_flex().flex_1().min_h(0).items_start().gap(GAP).px(PAD).pt(20)
        .child(v_flex().id("stage-scroll").flex_1().min_w(0).h_full().gap(48).pb(40).overflow_y_scrollbar()
          .when(Boolean(this.lane(t)), (el) => el.child(this.lane(t)))
          .child(grid(placed, 0))
          .when(loose.length > 0, (el) => el.child(v_flex().gap(14)
            .child(div().text_size(T.sm).font_weight(600).text_color(t.muted).child("No space yet"))
            .child(grid(loose, vm.placed)))))
        .when(this.st.zone === "agents", (el) => el.child(this.picker(t))));
  }
}
