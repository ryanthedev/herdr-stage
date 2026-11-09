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
import { theme, run, spaces, panes, focused, nextCommand, settings, terminals, agents, shared, setShared, readTextFile, appHome } from "herdr";
import { gather } from "./adapter.js";
import { buildStage } from "./core/stage.js";
import { nextGrid, colsFor, rowOf, layoutRows } from "./core/grid.js";
import { track, prune, rank } from "./core/order.js";
import { parentsOf, families, labelsOf } from "./core/nest.js";
import { search, nextSearch } from "./core/search.js";
import { tokens } from "./themes.js";

const MOD = "stage";
const T = { tiny: 11, cap: 12, sm: 13, body: 14, name: 19 };
const CARD_MIN = 270, CARD_H = 200, GAP = 12, PAD = 16, SLACK = 14; // SLACK: room for the scrollbar
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
    // Test seam: an isolated Herdr home can hold stage-test.json {"find": "query"} to open a search
    // without key automation. Absent in a real home.
    cx.spawn(async (cx) => {
      try {
        const seam = JSON.parse((await readTextFile(`${appHome()}/stage-test.json`)) ?? "null");
        if (typeof seam?.find === "string") { this.find = { query: seam.find, sel: 0 }; cx.notify(); }
      } catch {}
    });
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

  // Compact state counts: distinct color and shape cues without turning the card into a dashboard.
  counts(k, c, live) {
    const part = (n, label, color, ring) => h_flex().gap(4).items_center()
      .child(ring ? div().size(7).rounded(4).border(1).border_color(color) : div().size(7).rounded(4).bg(color))
      .child(div().text_color(color).child(`${n} ${label}`));
    const parts = [];
    if (c?.counts.move) parts.push(part(c.counts.move, "your move", k.move));
    if (c?.counts.working) parts.push(part(c.counts.working, "working", k.working));
    if (c?.counts.idle) parts.push(part(c.counts.idle, "idle", k.muted, true));
    const quiet = (n, one, many) => n ? [div().text_color(k.muted).font_weight(500).child(`${n} ${n > 1 ? many : one}`)] : [];
    parts.push(...quiet(c?.counts.mods, "dashboard", "dashboards"), ...quiet(c?.counts.procs, "process", "processes"), ...quiet(c?.counts.shells, "shell", "shells"));
    if (!parts.length) parts.push(div().text_color(k.idle).child(c ? "empty" : live.status ?? ""));
    return h_flex().gap(9).text_size(T.tiny).font_weight(600).children(parts);
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

  // A pane that isn't an agent: a dashboard (mod), a running process, or a shell.
  other(k, o) {
    const mark = o.kind === "mod" ? div().size(9).rounded(2).border(1).border_color(k.nestText ?? k.focus)
      : o.kind === "process" ? div().size(7).rounded(4).bg(k.ink2) : div().text_size(T.tiny).font_weight(700).text_color(k.idle).child("›");
    return h_flex().gap(8).items_center().min_w(0)
      .child(h_flex().w(14).flex_none().justify_center().child(mark))
      .child(div().flex_none().max_w(150).truncate().text_size(T.sm).text_color(o.kind === "shell" ? k.muted : k.ink).child(o.label))
      .child(div().flex_1().min_w(0).truncate().text_size(T.tiny).text_color(k.idle).child(o.kind === "mod" ? "dashboard" : o.detail ?? ""));
  }

  // The name, with the characters a search matched drawn in the focus colour.
  title(k, name, hits) {
    const s = k.caps ? name.toUpperCase() : name;
    if (!hits?.length) return div().flex_1().min_w(0).truncate().text_size(T.name).font_weight(k.headWeight).text_color(k.head).child(s);
    const on = new Set(hits), segs = [];
    for (let i = 0; i < s.length; i++) {
      const m = on.has(i), last = segs[segs.length - 1];
      if (last && last.m === m) last.t += s[i]; else segs.push({ m, t: s[i] });
    }
    return h_flex().flex_1().min_w(0).overflow_hidden().text_size(T.name).font_weight(k.headWeight)
      .children(segs.map((g) => div().flex_none().text_color(g.m ? k.focus : k.head).child(g.t)));
  }

  card(k, e, i, w) {
    const live = e.space;
    const c = this.byId[live.id], on = i === this.sel, move = Boolean(c?.hasMove);
    const branch = live.branch ?? (c?.facts.find((f) => f.startsWith("⎇")) ?? "").replace("⎇ ", "");
    const folder = c?.facts[0] ?? "";
    // Up to two lines: agents first, then dashboards, processes and shells to fill.
    const top = (c?.top ?? []).slice(0, 2), fill = (c?.others ?? []).slice(0, 2 - top.length);
    const more = (c?.rows.length ?? 0) + (c?.others?.length ?? 0) - top.length - fill.length;
    const parentName = e.parent ? spaces().find((s) => s.id === e.parent)?.name : null;
    const cardBg = on ? k.cardSelected : move ? k.cardUrgent : k.card;
    return v_flex().w(w).h(CARD_H).flex_none().px(e.depth ? 20 : 16).pt(13).pb(11).rounded(12).overflow_hidden().relative()
      // Nested cards get a short branch connector and a parent crumb, so family membership survives
      // even when a narrow pane wraps each family member onto its own row.
      .when(Boolean(e.depth), (el) => el
        .child(div().absolute().left(8).top(0).w(1).h(29).bg(k.nestLine))
        .child(div().absolute().left(8).top(28).w(13).h(1).bg(k.nestLine)))
      .bg(cardBg).when(Boolean(c?.loose), (el) => el.bg(k.looseBg).border_dashed())
      .border(on ? 2 : 1).border_color(on ? k.focus : move ? k.moveLine : k.line)
      .when(on, (el) => el.shadow_md())
      .child(h_flex().flex_none().gap(8).items_center()
        .child(this.title(k, live.name, e.hits))
        .when(e.kids > 0, (el) => el.child(div().flex_none().text_size(T.tiny).font_weight(600).text_color(k.nestText).child(`${e.kids} nested`)))
        .when(live.active, (el) => el.child(div().flex_none().px(7).py(2).rounded(999).bg(tint(k.focus, 0x20, k.selBg)).text_size(T.tiny).font_weight(700).text_color(k.focus).child("HERE"))))
      .when(Boolean(parentName), (el) => el.child(div().flex_none().mt(3).truncate().text_size(T.tiny).font_weight(600).text_color(k.nestText)
        .child(`↳ ${parentName}`)))
      .child(div().flex_none().mt(parentName ? 2 : 4).truncate().text_size(T.cap).text_color(k.muted).child([
        folder, branch && `⎇ ${branch}`].filter(Boolean).join("  ·  ")))
      .child(div().flex_none().mt(8).child(this.counts(k, c, live)))
      .when(top.length + fill.length > 0, (el) => el.child(v_flex().flex_none().mt(9).pt(8).gap(7).border_t(1).border_color(k.border).min_w(0)
        .children([...top.map((r) => this.agent(k, r)), ...fill.map((o) => this.other(k, o))])))
      .child(div().flex_1())
      .when(more > 0, (el) => el.child(div().text_size(T.tiny).text_color(k.idle).child(`${more} more`)));
  }

  key(e, list, rows, cx) {
    if (this.find) return this.findKey(e, list, cx);
    if (e.key === "/") { this.find = { query: "", sel: 0 }; this.scroll.scroll_to_item(0); cx.stop_propagation(); return cx.notify(); }
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

  // Keys while searching: typing filters, ctrl-n/p or arrows move, Enter goes there, Esc goes back to
  // the grid with the picked card selected.
  findKey(e, list, cx) {
    if (e.modifiers?.platform) return;
    const r = nextSearch(this.find, e.key, list.length, { control: Boolean(e.modifiers?.control) });
    const moved = r.sel !== this.find.sel || r.query !== this.find.query;
    this.find = { query: r.query, sel: r.sel };
    if (moved) this.scroll.scroll_to_item(r.sel);
    const pick = list[r.effect?.open ?? r.sel];
    if (r.effect?.open !== undefined) { this.find = null; this.selId = pick?.id ?? this.selId; this.go(pick?.space); }
    if (r.effect?.close) { this.find = null; if (pick) this.selId = pick.id; }
    cx.stop_propagation(); cx.notify();
  }

  // Search results: every card that matches all words, best first, flat (no families).
  found() {
    const all = this.shown(), byId = Object.fromEntries(all.map((e) => [e.id, e]));
    const cards = all.map((e) => {
      const c = this.byId[e.id];
      return { id: e.id, fields: [
        { key: "name", text: e.space.name, weight: 2 },
        { key: "where", text: [c?.facts[0], e.space.branch].filter(Boolean).join(" ") },
        { key: "agents", text: (c?.rows ?? []).map((r) => `${r.label} ${r.move ?? r.line ?? ""}`).join(" "), weight: 0.6 },
        { key: "panes", text: (c?.others ?? []).map((o) => o.label).join(" "), weight: 0.6 },
      ] };
    });
    return search(this.find.query, cards).map((m) => ({ ...byId[m.id], depth: 0, parent: null, kids: 0, hits: m.hits.name }));
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
    const list = this.find ? this.found() : this.shown();
    if (this.find) this.find.sel = Math.max(0, Math.min(this.find.sel, list.length - 1));
    const at = this.selId ? list.findIndex((e) => e.id === this.selId) : -1;
    this.sel = this.find ? this.find.sel : at >= 0 ? at : Math.max(0, Math.min(this.sel, list.length - 1));
    // Search results are one column, like Telescope's list; the grid is back when the search closes.
    const cols = this.find ? 1 : this.cols(), w = this.cardW(cols);
    const rows = this.find ? list.map((_, i) => [i]) : layoutRows(list.map((e) => e.depth), cols);
    const root = v_flex().id("stage").track_focus(this.handle).size_full().bg(k.bg).text_color(k.ink)
      // Sizes arrive multiplied by the app's zoom; layout math is in the mod's own px.
      .on_size_change((size, cx) => {
        const z = Number(settings().zoom) || 1, nw = size.width / z;
        if (Math.abs(nw - this.width) > 2) { this.width = nw; cx.notify(); }
      })
      .on_key_down((e, cx) => this.key(e, list, rows, cx));
    const header = h_flex().px(18).pt(15).pb(12).gap(10).items_end()
      .child(div().text_size(T.name + 1).font_weight(700).text_color(k.head).child(k.caps ? "STAGE" : "Stage"))
      .child(div().pb(2).text_size(T.cap).text_color(k.muted).child(`${spaces().length} spaces`))
      .child(div().flex_1())
      .when(this.lane > 0, (el) => el.child(h_flex().mb(1).gap(6).items_center().px(9).py(3).rounded(999).bg(tint(k.move, 0x22, k.moveBg))
        .child(div().size(6).rounded(3).bg(k.move))
        .child(div().text_size(T.cap).font_weight(700).text_color(k.move).child(`${this.lane} waiting on you`))));
    const prompt = this.find && h_flex().mx(PAD).mb(4).px(12).py(8).gap(8).items_center().rounded(10)
      .bg(k.card).border(1).border_color(k.focus)
      .child(div().text_size(T.body).font_weight(700).text_color(k.focus).child("/"))
      .child(div().text_size(T.body).text_color(k.ink).child(this.find.query))
      .child(div().w(2).h(16).bg(k.focus))
      .child(div().flex_1())
      .child(div().text_size(T.tiny).text_color(k.muted).child(`${list.length} match${list.length === 1 ? "" : "es"}`));
    const grid = v_virtual_list("stage-grid", rows.length, ROW_H, (r) => String(r), (range) => {
      const out = [];
      for (let r = range.start; r < range.end; r++)
        out.push(h_flex().h(ROW_H).px(PAD).gap(GAP).items_start().children(rows[r].map((i) => this.card(k, list[i], i, w))));
      return out;
    }).track_scroll(this.scroll).size_full()
      .on_item_click((rowKey, cx) => { if (this.find) { this.find.sel = Number(rowKey); this.handle.focus(); return cx.notify(); } this.click(rowKey, list, rows, cx); });
    const body = div().relative().flex_1().min_h(0).w_full().pt(PAD)
      .on_mouse_down("left", (e) => { const z = Number(settings().zoom) || 1; this.downX = (e.local_position?.x ?? e.position?.x ?? 0) / z; })
      .child(grid)
      .child(Scrollbar.vertical("stage-grid").absolute().inset_0());
    const foot = div().px(18).py(8).border_t(1).border_color(k.border).text_size(T.tiny).text_color(k.muted)
      .child(this.error ? `Couldn't read agents: ${this.error}` : !this.loaded ? "Reading agents…" : this.find ? "type to filter · ⌃n ⌃p move · ↵ go · esc back" : "h j k l move · / search · ↵ go to space · q close");
    return root.child(header).when(Boolean(prompt), (el) => el.child(prompt)).child(body).child(foot);
  }
}
