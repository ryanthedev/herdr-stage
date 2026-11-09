// Stage, as a side pane: every space as a card in a grid, h j k l to move, Enter to go there.
// Opened with pane.split {mod: "stage"} (cmd-g in keys.json). Focusable like herdr-md: pane.go moves the
// keyboard in and out. The old full-window popup (canvas, zoom) lives on in ./dialog.js, not installed.
//
// Data: names and the shown space come live from spaces(); counts and asks from ./adapter.js (git and
// transcript reads), refreshed every 10s while the pane is open.
//
// Order (core/order.js): spaces with a blocked agent or an ask first, then by a score of how much you're
// in each space and how recently anything happened in it. Stage records where you are itself, in
// shared("stage.presence"), whenever a Stage pane is open. The order is recomputed on each refresh only,
// so cards don't jump while you move. Nesting (core/nest.js): a terminal labelled stage.parent=<space>
// puts its space under that one; a family starts a new row.
//
// The grid is a virtual list of rows, because that is the one scroll area code can scroll (to keep the
// selected card on screen). Its renderer may hold no handlers and must state row heights, so cards are a
// fixed height and clicks come through the list (row key) plus a mouse-down on the wrapper (column).

import { View, div } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { theme, run, spaces, panes, focused, nextCommand, settings, terminals, agents, shared, setShared } from "herdr";
import { gather } from "./adapter.js";
import { buildStage } from "./core/stage.js";
import { nextGrid, colsFor, rowOf, layoutRows } from "./core/grid.js";
import { track, prune, rank } from "./core/order.js";
import { parentsOf, families, labelsOf } from "./core/nest.js";
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
    this.selId = null; // the selection follows the space, not its position, when the order changes
    this.byId = {};
    this.entries = []; // [{ id, depth, parent, kids }] in display order, from the last refresh
    this.store = shared("stage.presence") ?? {};
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
        this.reorder();
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loading = false;
      this.loaded = true;
      cx.notify();
    });
  }

  go(sp) { if (sp) run("space.select", { id: sp.id }); }

  // Note where you are now (called on refresh and whenever the shown space changes); saved on refresh.
  presence(save) {
    const sp = spaces(), active = sp.find((s) => s.active)?.id ?? null;
    if (!save && active === this.store._active) return;
    this.store = track(this.store, active, Date.now());
    if (save) { this.store = prune(this.store, sp.map((s) => s.id)); setShared("stage.presence", this.store); }
  }

  reorder() {
    this.presence(true);
    const sp = spaces(), now = Date.now();
    const items = sp.map((s) => {
      const c = this.byId[s.id];
      const at = Math.max(0, ...s.tabs.map((t) => t.changed_at ?? 0), ...(c?.rows ?? []).map((r) => Date.parse(r.at ?? "") || 0));
      return { id: s.id, urgent: s.status === "blocked" || Boolean(c?.counts.move), activityAt: at || null };
    });
    const agentSpace = Object.fromEntries(agents().map((a) => [a.address, a.space]));
    const where = (t) => labelsOf(t)["herdr.space"] ?? agentSpace[t.address] ?? null;
    this.parent = parentsOf(terminals().filter((t) => t.state === "live"), sp, where);
    this.entries = families(rank(items, this.store, now), this.parent);
  }

  // The display list: the last refresh's order, with spaces made since then appended at top level.
  shown() {
    const byId = Object.fromEntries(spaces().map((s) => [s.id, s]));
    const seen = new Set(), out = [];
    for (const e of this.entries) if (byId[e.id]) { out.push({ ...e, space: byId[e.id] }); seen.add(e.id); }
    for (const s of Object.values(byId)) if (!seen.has(s.id)) out.push({ id: s.id, depth: 0, parent: null, kids: 0, space: s });
    return out;
  }

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

  card(k, e, i, w) {
    const live = e.space;
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
      .child(div().mt(3).truncate().text_size(T.cap).text_color(k.muted).child([
        e.parent && `↳ ${spaces().find((s) => s.id === e.parent)?.name ?? ""}`, e.kids && `${e.kids} nested`,
        folder, branch && `⎇ ${branch}`].filter(Boolean).join("  ·  ")))
      .child(div().mt(8).child(this.counts(k, c, live)))
      .when(top.length > 0, (el) => el.child(v_flex().mt(10).pt(10).gap(8).border_t(1).border_color(k.border).min_w(0)
        .children(top.map((r) => this.agent(k, r)))))
      .child(div().flex_1())
      .when(more > 0, (el) => el.child(div().text_size(T.tiny).text_color(k.idle).child(`${more} more agent${more > 1 ? "s" : ""}`)));
  }

  key(e, list, rows, cx) {
    if (e.modifiers?.platform || e.modifiers?.control) return; // cmd-h/l etc. stay the app's
    const before = this.sel;
    const r = nextGrid(this.sel, e.key, rows, Boolean(e.modifiers?.shift));
    this.sel = r.sel;
    this.selId = list[this.sel]?.id ?? null;
    if (this.sel !== before) this.scroll.scroll_to_item(rowOf(this.sel, rows));
    if (r.effect?.open !== undefined) this.go(list[r.effect.open]?.space);
    if (r.effect?.close) { const me = panes().find((p) => p.focused && p.mod === MOD); if (me) run("pane.close", { pane: me.pane }); }
    cx.stop_propagation(); cx.notify();
  }

  // A click: the wrapper's mouse-down gives the column, the list's item click gives the row.
  click(rowKey, list, rows, cx) {
    const cols = this.cols(), w = this.cardW(cols), row = rows[Number(rowKey)] ?? [];
    const col = Math.floor((this.downX - PAD) / (w + GAP));
    const i = row[Math.max(0, Math.min(row.length - 1, col))];
    if (i !== undefined) { this.sel = i; this.selId = list[i]?.id ?? null; }
    this.handle.focus();
    cx.notify();
  }

  render(cx) {
    const k = tokens(theme(), "default");
    this.presence(false);
    const list = this.shown();
    const at = this.selId ? list.findIndex((e) => e.id === this.selId) : -1;
    this.sel = at >= 0 ? at : Math.max(0, Math.min(this.sel, list.length - 1));
    const cols = this.cols(), w = this.cardW(cols), rows = layoutRows(list.map((e) => e.depth), cols);
    const root = v_flex().id("stage").track_focus(this.handle).size_full().bg(k.bg).text_color(k.ink)
      // Sizes arrive multiplied by the app's zoom; layout math is in the mod's own px.
      .on_size_change((size, cx) => {
        const z = Number(settings().zoom) || 1, nw = size.width / z;
        if (Math.abs(nw - this.width) > 2) { this.width = nw; cx.notify(); }
      })
      .on_key_down((e, cx) => this.key(e, list, rows, cx));
    const header = h_flex().px(18).pt(16).pb(12).gap(10).items_end()
      .child(div().font_family(k.display).text_size(T.name + 2).font_weight(k.headWeight).text_color(k.head).child(k.caps ? "STAGE" : "Stage"))
      .child(div().pb(2).text_size(T.cap).text_color(k.muted).child(`${list.length} spaces`))
      .child(div().flex_1())
      .when(this.lane > 0, (el) => el.child(h_flex().mb(1).gap(6).items_center().px(9).py(3).rounded(999).bg(tint(k.move, 0x22, k.moveBg))
        .child(div().size(6).rounded(3).bg(k.move))
        .child(div().text_size(T.cap).font_weight(700).text_color(k.move).child(`${this.lane} waiting on you`))));
    const grid = v_virtual_list("stage-grid", rows.length, ROW_H, (r) => String(r), (range) => {
      const out = [];
      for (let r = range.start; r < range.end; r++)
        out.push(h_flex().h(ROW_H).px(PAD).gap(GAP).items_start().children(rows[r].map((i) => this.card(k, list[i], i, w))));
      return out;
    }).track_scroll(this.scroll).size_full()
      .on_item_click((rowKey, cx) => this.click(rowKey, list, rows, cx));
    const body = div().relative().flex_1().min_h(0).w_full().pt(PAD)
      .on_mouse_down("left", (e) => { const z = Number(settings().zoom) || 1; this.downX = (e.local_position?.x ?? e.position?.x ?? 0) / z; })
      .child(grid)
      .child(Scrollbar.vertical("stage-grid").absolute().inset_0());
    const foot = div().px(18).py(8).border_t(1).border_color(k.border).text_size(T.tiny).text_color(k.idle)
      .child(this.error ? `Couldn't read agents: ${this.error}` : !this.loaded ? "Reading agents…" : "h j k l move · ↵ go to space · q close");
    return root.child(header).child(body).child(foot);
  }
}
