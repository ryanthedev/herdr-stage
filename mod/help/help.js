// herdr-help: one key-help overlay for every mod. Copied into each mod (Herdr won't import from outside
// a mod's folder); edit it here and run ./sync.sh. Pure logic lives in ./help-core.js.
//
// Use, in a mod whose root element is relative():
//   import { Help } from "./help/help.js";
//   init:    this.keysHelp = new Help(SECTIONS, { title: "Stage keys", mod: "stage" });
//   keys:    if (this.keysHelp.key(e, cx)) return;      // first line of on_key_down: ? opens, it eats keys while open
//   render:  root.child(this.keysHelp.panel(colors))     // null while closed
//   button:  this.keysHelp.button(colors)                // optional clickable "?"
// colors: { bg, surface, border, ink, ink2, dim, accent, warn, font, mono } (any missing fall back to theme()).
//
// What it does: fades and drifts in; sections flow into as many columns as fit; keys draw as keycaps;
// / filters (every word must match), j/k ctrl-d/u g/G and the wheel scroll it, a scrollbar shows where you
// are, any other key or a click outside closes it. Rows whose key keys.json gives to Herdr first are
// marked (row option { bind: "cmd-d" }).

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, settings, readTextFile, appHome } from "herdr";
import { filterSections, countRows, isHelpKey, helpKey, takenKeys, takenBy } from "./help-core.js";

export { filterSections, countRows, isHelpKey, helpKey, takenKeys, takenBy };

const FADE = 180, STEP = 140;

export class Help {
  constructor(sections, { title = "Keys", mod = null, h = false, width = 760 } = {}) {
    this.sections = sections;
    this.title = title;
    this.mod = mod;
    this.h = h;
    this.width = width;
    this.shown = false;
    this.in = 0;
    this.st = { q: "", typing: false, y: 0 };
    this.contentH = 0;
    this.viewH = 0;
    this.availH = 0;
    this.availW = 0;
    this.taken = new Map();
  }

  open(cx) {
    this.shown = true; this.in = 0; this.st = { q: "", typing: false, y: 0 };
    cx.notify();
    cx.timer.after(16, (cx) => { this.in = 1; cx.notify(); });
    if (this.mod) cx.spawn(async (cx) => {
      try { this.taken = takenKeys(await readTextFile(`${appHome()}/keys.json`), this.mod); cx.notify(); } catch {}
    });
  }

  close(cx) {
    this.in = 0; cx.notify();
    cx.timer.after(FADE, (cx) => { if (!this.in) { this.shown = false; cx.notify(); } });
  }

  toggle(cx) { if (this.shown && this.in) this.close(cx); else this.open(cx); }

  // Call first in the mod's on_key_down. Returns true when the key was help's (then stop there).
  key(e, cx) {
    if (!this.shown) {
      if (!isHelpKey(e, { h: this.h })) return false;
      this.open(cx); cx.stop_propagation(); return true;
    }
    const m = e.modifiers ?? {};
    if (m.platform) return false; // cmd keys stay Herdr's
    const key = m.shift && e.key?.length === 1 ? (e.key_char ?? e.key.toUpperCase()) : e.key;
    const page = this.viewH || 300, max = Math.max(0, this.contentH - this.viewH);
    if (!this.st.typing && isHelpKey(e, { h: this.h })) { this.close(cx); cx.stop_propagation(); return true; }
    const r = helpKey(this.st, key, { control: Boolean(m.control), shift: Boolean(m.shift), platform: false }, { page, max });
    this.st = r.st;
    if (r.close) this.close(cx); else cx.notify();
    cx.stop_propagation();
    return true;
  }

  wheel(dy, cx) {
    const max = Math.max(0, this.contentH - this.viewH);
    this.st = { ...this.st, y: Math.max(0, Math.min(max, this.st.y + dy)) };
    cx.notify();
  }

  // A small "?" chip that opens it, for a toolbar or status line.
  button(c = {}) {
    const k = palette(c);
    return div().id("herdr-help-button").flex_none().px(7).h(20).flex().items_center().rounded(5).cursor_pointer()
      .border(1).border_color(this.shown ? k.accent : k.border).text_color(this.shown ? k.accent : k.dim).text_size(12)
      .hover((s) => s.text_color(k.ink)).on_click((_e, cx) => { this.toggle(cx); cx.notify(); }).child("?");
  }

  panel(c = {}) {
    if (!this.shown) return null;
    const k = palette(c), z = Number(settings().zoom) || 1;
    const shown = filterSections(this.sections, this.st.q), count = countRows(shown);
    // How wide the card really is: what it asks for, or the pane when that's narrower (a docked mod).
    // Narrow, the key column shrinks, sections take the full width, and the field drops its long hint.
    const cardW = Math.min(this.width, this.availW || this.width), narrow = cardW < 480;
    const keyW = narrow ? 92 : 132, colMin = Math.min(300, Math.max(160, cardW - 2));
    // The list's window: as tall as its content, up to what the pane leaves under the title and field.
    const CHROME = 104, maxView = Math.max(80, (this.availH || 400) - CHROME);
    this.viewH = Math.min(this.contentH || maxView, maxView);
    const scrolls = this.contentH > this.viewH + 0.5;
    const cap = (s) => div().flex_none().px(6).h(20).flex().items_center().rounded(4).bg(k.surface).border(1).border_color(k.border)
      .font_family(k.mono).text_size(11.5).text_color(k.ink).child(s);
    const row = (r) => {
      const [keys, what] = r, herdr = takenBy(r, this.taken);
      return h_flex().gap(10).items_start().py(2)
        .child(h_flex().w(keyW).flex_none().flex_wrap().gap(4).children(String(keys).split(" ").filter(Boolean).map(cap)))
        .child(v_flex().flex_1().min_w(0).pt(1)
          .child(div().text_size(12.5).text_color(herdr ? k.dim : k.ink2).child(what))
          .when(Boolean(herdr), (el) => el.child(div().text_size(11).text_color(k.warn).child(`Herdr takes this key first (${herdr})`))));
    };
    const hint = narrow ? (this.st.q ? `${count}` : "") : this.st.typing ? (this.st.q ? `${count} · Enter: j/k · Esc clears` : "type to filter · Esc")
      : this.st.q ? `${count} · / edit` : scrolls ? "/ filter · j k scroll · any other key closes" : "/ filter · any other key closes";
    const field = h_flex().h(30).px(10).gap(8).items_center().rounded(8).bg(k.bg).border(1).border_color(this.st.typing ? k.accent : k.border)
      .child(div().text_color(k.dim).child("⌕"))
      .child(h_flex().flex_1().min_w(0).items_center().gap(1).text_size(12.5)
        .child(div().min_w(0).truncate().text_color(this.st.q ? k.ink : k.dim).child(this.st.q || (this.st.typing ? "" : "Search the keys  /")))
        .when(this.st.typing, (el) => el.child(div().w(2).h(14).bg(k.accent))))
      .child(div().flex_shrink_1().min_w(0).truncate().text_size(11).text_color(this.st.q && !count ? k.warn : k.dim).child(hint));
    const thumb = scrolls ? Math.max(24, (this.viewH * this.viewH) / this.contentH) : 0;
    const view = div().id("herdr-help-view").relative().overflow_hidden().w_full().flex_none().h(this.viewH)
      .child(h_flex().absolute().left(0).w_full().top(-this.st.y).transition("top", { duration: STEP, easing: "ease-out" })
        .flex_wrap().items_start()
        .on_size_change((size, cx) => { const h = size.height / z; if (Math.abs(h - this.contentH) > 0.5) { this.contentH = h; cx.notify(); } })
        .when(!count, (el) => el.child(div().px(16).py(6).text_color(k.dim).child("No keys match")))
        .children(shown.map(([title, rows]) => v_flex().flex_1().min_w(colMin).px(16).pb(12).gap(1)
          .child(div().pb(3).text_size(11).font_weight(600).text_color(k.accent).child(title))
          .children(rows.map(row)))))
      .when(scrolls, (el) => el.child(div().absolute().right(3).w(4).rounded(2).bg(k.border).h(thumb)
        .top(((this.viewH - thumb) * this.st.y) / Math.max(1, this.contentH - this.viewH))));
    const card = v_flex().id("herdr-help-card").w(this.width).max_w_full().pt(14).pb(6).gap(10).rounded(12)
      .bg(k.surface).border(1).border_color(k.border).shadow_md().font_family(k.font)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_scroll_wheel((e, cx) => { cx.stop_propagation(); this.wheel(-e.delta.y / z, cx); })
      .child(h_flex().px(16).items_center().gap(10)
        .child(div().flex_1().text_size(15).font_weight(600).text_color(k.ink).child(this.title))
        .child(div().flex_none().text_size(11).text_color(k.dim).child("? or Esc closes")))
      .child(div().px(12).child(field))
      .child(view);
    // The backdrop: dims what's behind and closes on a click outside the card. The card's wrapper takes the
    // pane's width, so max_w_full caps the card at the pane (a docked Stage is ~440px; the card asks for 760)
    // and the sections, min 300px each, fall into one column instead of spilling off both sides.
    return div().id("herdr-help").absolute().inset_0().p(16).flex().justify_center().items_start()
      .on_size_change((size, cx) => {
        const h = size.height / z - 32, w = size.width / z - 32;
        if (Math.abs(h - (this.availH || 0)) > 0.5 || Math.abs(w - (this.availW || 0)) > 0.5) { this.availH = h; this.availW = w; cx.notify(); }
      })
      .bg(k.scrim).opacity(this.in).transition("opacity", { duration: FADE, easing: "ease-out" })
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.close(cx); })
      .child(div().relative().top(this.in ? 8 : 20).transition("top", { duration: 220, easing: "ease-out" }).w_full().max_h_full().flex().justify_center().child(card));
  }
}

function palette(c) {
  const t = theme() ?? {};
  const k = {
    bg: c.bg ?? t.background ?? "#111111", surface: c.surface ?? t.popover ?? "#1b1b1b", border: c.border ?? t.border ?? "#333333",
    ink: c.ink ?? t.foreground ?? "#eeeeee", ink2: c.ink2 ?? t.foreground ?? "#cccccc", dim: c.dim ?? t.dim ?? t.muted ?? "#888888",
    accent: c.accent ?? t.accent ?? "#7fb5ff", warn: c.warn ?? t.blocked ?? "#ff6fa3",
    font: c.font ?? null, mono: c.mono ?? c.font ?? "SF Mono",
  };
  k.scrim = c.scrim ?? (/^#[0-9a-f]{6}$/i.test(k.bg) ? k.bg + "B0" : "#000000B0");
  return k;
}
