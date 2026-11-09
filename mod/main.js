// Stage, as a side pane: one space per row, j/k to move, Enter to go there, / to search.
// Opened with pane.split {mod: "stage"} (cmd-g in keys.json). Focusable like herdr-md: pane.go moves the
// keyboard in and out. The old full-window popup (canvas, zoom) lives on in ./dialog.js, not installed.
//
// Data: names and the shown space come live from spaces(); counts, asks, panes and screen previews from
// ./adapter.js, refreshed every 10s while the pane is open.
//
// Order (core/order.js): spaces with a blocked agent or an ask first, then by a score of how much you're
// in each space and how recently anything happened in it. Stage records where you are itself, in
// shared("stage.presence"), whenever a Stage pane is open. The order is recomputed on each refresh only,
// so rows don't jump while you move. Nesting (core/nest.js): a terminal labelled stage.parent=<space>
// puts its space under that one.
//
// Layout (core/rows.js): the pane's width picks a tier; each tier drops detail (screen previews, then
// thumbnails, then paths and quiet items) so the most important things survive a narrow pane. The space
// you're in is pinned under the header and left out of the scrolling list.
//
// The list is a virtual list, because that is the one scroll area code can scroll (to keep the selection
// on screen). Its renderer may hold no handlers and must state row heights, so heights come from
// core/rows.js and clicks come through the list's item click.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { theme, run, spaces, panes, focused, nextCommand, settings, terminals, agents, shared, setShared, readTextFile, appHome } from "herdr";
import { gather } from "./adapter.js";
import { buildStage } from "./core/stage.js";
import { nextGrid } from "./core/grid.js";
import { tierFor, rowView, rowHeight, statusOf, bubbleW, ROW, SIDE, BUBBLE_GAP } from "./core/rows.js";
import { track, prune, rank } from "./core/order.js";
import { parentsOf, families, labelsOf } from "./core/nest.js";
import { search, nextSearch } from "./core/search.js";
import { MISSION as K } from "./themes.js";

const MOD = "stage";
// Heel's overview type: name 16/600, status 12, mono meta 10, bubble title 13.5/600, message 12.5.
const T = { meta: 10, msg: 12.5, title: 13.5, status: 12, name: 16, field: 14 };

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
    this.width = 0; // unknown until the pane reports its size
    // Herdr reports a size only for a new element or a changed size, so after a hot reload into a pane
    // that kept its size the old id would never report again. A fresh id per instance always does.
    this.uid = Math.random().toString(36).slice(2, 8);
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
    if (this.loading) { this.again = true; return; } // run once more when the current read finishes
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const vm = buildStage(await gather({ previews: ["xl", "l"].includes(tierFor(this.width)) }));
        this.byId = Object.fromEntries(vm.cards.map((c) => [c.id, c]));
        this.lane = vm.lane.length;
        this.reorder();
        this.error = null;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loading = false;
      this.loaded = true;
      cx.notify();
      if (this.again) { this.again = false; this.refresh(cx); }
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

  // The status word after a space's name, with its dot: amber "needs you", mint "working", sage "done".
  status(c, live) {
    const word = statusOf(c, live.status);
    const color = word === "needs you" ? K.amber : word === "working" ? K.accent : word === "done" ? K.done : K.ink3;
    return h_flex().flex_none().gap(5).items_center()
      .child(word === "idle" || word === "empty" ? div().size(7).rounded(4).border(1).border_color(color) : div().size(7).rounded(4).bg(color))
      .child(div().text_size(T.status).text_color(color).child(word));
  }

  // The mono line under the name: branch, folder, nested-under, and the rest as labelled counts.
  metaLine(e, c, live) {
    const branch = live.branch ?? (c?.facts.find((f) => f.startsWith("⎇")) ?? "").replace("⎇ ", "");
    const parentName = e.parent ? spaces().find((s) => s.id === e.parent)?.name : null;
    const n = (v, one, many) => (v ? `${v} ${v > 1 ? many : one}` : null);
    const parts = [parentName && `↳ ${parentName}`, branch && `⎇ ${branch}`, c?.facts[0],
      n(c?.counts.idle, "idle", "idle"), n(c?.counts.mods, "dashboard", "dashboards"), n(c?.counts.shells, "shell", "shells"), n(c?.counts.procs, "process", "processes"),
      e.kids ? `${e.kids} nested` : null];
    return div().truncate().font_family(K.mono).text_size(T.meta).text_color(K.ink3).child(parts.filter(Boolean).join(" · "));
  }

  // One item as a message bubble: [tab chip] name · time / title / message. Needs-you bubbles are amber.
  bubble(i, w) {
    const need = Boolean(i.move);
    const name = i.kind === "agent" ? (i.label !== i.title ? i.label : i.addr) : i.kind === "mod" ? "dashboard" : i.kind;
    const title = i.kind === "agent" ? i.title || i.label : i.label;
    const msg = i.move ?? i.line ?? (i.kind === "mod" ? i.detail : i.detail ?? "");
    return v_flex().w(w).h(ROW.bubble).flex_none().px(11).py(9).gap(3).overflow_hidden()
      .rounded_tl(16).rounded_tr(16).rounded_br(16).rounded_bl(6)
      .bg(need ? K.needBg : K.surface).when(need, (el) => el.border(1).border_color(K.needLine))
      .child(h_flex().flex_none().h(16).gap(6).items_center().min_w(0).font_family(K.mono).text_size(T.meta).text_color(K.ink3)
        // Unnamed tabs are just their position ("1"): only a named tab earns a chip.
        .when(Boolean(i.tab) && !/^\d+$/.test(String(i.tab)), (el) => el.child(div().flex_none().px(6).py(1).rounded(5).bg(K.field).text_color(K.ink2).child(String(i.tab))))
        .child(div().min_w(0).truncate().child(name))
        .when(Boolean(i.at), (el) => el.child(div().flex_none().child(`· ${ago(i.at)}`))))
      .child(div().flex_none().h(19).truncate().text_size(T.title).font_weight(600).text_color(K.ink).child(title || ""))
      .child(div().flex_none().h(17).truncate().text_size(T.msg).text_color(need ? K.amber : K.ink2).child(msg || ""));
  }

  // The name, with the characters a search matched drawn in the accent.
  title(name, hits) {
    if (!hits?.length) return div().min_w(0).truncate().text_size(T.name).font_weight(600).text_color(K.ink).child(name);
    const on = new Set(hits), segs = [];
    for (let i = 0; i < name.length; i++) {
      const m = on.has(i), last = segs[segs.length - 1];
      if (last && last.m === m) last.t += name[i]; else segs.push({ m, t: name[i] });
    }
    return h_flex().min_w(0).overflow_hidden().text_size(T.name).font_weight(600)
      .children(segs.map((g) => div().flex_none().text_color(g.m ? K.accent : K.ink).child(g.t)));
  }

  // One space as a row: header line, meta line, bubbles. No card: rows sit on the ground, split by a hairline.
  // `on`: the keyboard selection (a mint edge and a faint lift, nothing louder).
  row(e, on, tier, w) {
    const live = e.space, c = this.byId[live.id], v = rowView(c, tier, w);
    const indent = e.depth ? Math.min(3, e.depth) * 16 : 0, bw = tier === "s" ? w - 2 * SIDE - indent : bubbleW(w);
    const head = h_flex().gap(8).items_center().min_w(0)
      .child(this.title(live.name, e.hits))
      .child(this.status(c, live))
      .when(live.active, (el) => el.child(div().flex_none().font_family(K.mono).text_size(T.meta).text_color(K.accent).child("here")))
      .child(div().flex_1());
    const body = v_flex().h(rowHeight(c, tier)).w_full().pl(SIDE + indent).pr(SIDE).justify_center().relative()
      .when(on, (el) => el.bg(K.selBg).child(div().absolute().left(0).top(8).bottom(8).w(3).rounded(2).bg(K.accent)))
      .when(Boolean(e.depth), (el) => el.child(div().absolute().left(SIDE + indent - 10).top(0).h(22).w(1).bg(K.rule))
        .child(div().absolute().left(SIDE + indent - 10).top(22).w(6).h(1).bg(K.rule)))
      .child(head);
    if (tier === "xs") return body;
    return body.child(div().mt(2).child(this.metaLine(e, c, live)))
      .when(v.bubbles.length > 0, (el) => el.child(h_flex().mt(ROW.gap).gap(BUBBLE_GAP).min_w(0).overflow_hidden()
        .children([...v.bubbles.map((i) => this.bubble(i, bw)),
          ...(v.more > 0 ? [div().flex_none().self_center().px(4).font_family(K.mono).text_size(T.meta).text_color(K.ink3).child(`+${v.more}`)] : [])])));
  }

  key(e, list, rows, cx) {
    if (this.find) return this.findKey(e, list, cx);
    if (e.key === "/") { this.find = { query: "", sel: 0 }; this.scroll.scroll_to_item(0); cx.stop_propagation(); return cx.notify(); }
    if (e.modifiers?.platform || e.modifiers?.control) return; // cmd-h/l etc. stay the app's
    const before = this.sel;
    const r = nextGrid(this.sel, e.key, rows, Boolean(e.modifiers?.shift));
    this.sel = r.sel;
    this.selId = list[this.sel]?.id ?? null;
    if (this.sel !== before) this.scroll.scroll_to_item(this.sel);
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

  render(cx) {
    this.presence(false);
    const w = this.width || 640, tier = tierFor(w);
    // The space you're in is pinned at the top (not while searching), so the list leaves it out.
    const all = this.find ? this.found() : this.shown();
    const pinned = this.find ? null : all.find((e) => e.space.active);
    const list = pinned ? all.filter((e) => e !== pinned) : all;
    if (this.find) this.find.sel = Math.max(0, Math.min(this.find.sel, list.length - 1));
    const at = this.selId ? list.findIndex((e) => e.id === this.selId) : -1;
    this.sel = this.find ? this.find.sel : at >= 0 ? at : Math.max(0, Math.min(this.sel, list.length - 1));
    const rows = list.map((_, i) => [i]);
    const heights = list.map((e) => rowHeight(this.byId[e.id], tier) + 1); // + the hairline between rows
    const root = v_flex().id(`stage-${this.uid}`).track_focus(this.handle).size_full().bg(K.bg).text_color(K.ink)
      // Sizes arrive multiplied by the app's zoom; layout math is in the mod's own px.
      .on_size_change((size, cx) => {
        const z = Number(settings().zoom) || 1, nw = size.width / z;
        if (Math.abs(nw - this.width) > 2) { this.width = nw; cx.notify(); }
      })
      .on_key_down((e, cx) => this.key(e, list, rows, cx));
    const pin = pinned && div().pt(6).border_b(1).border_color(K.rule).child(this.row({ ...pinned, depth: 0 }, false, tier, w));
    const vlist = v_virtual_list("stage-rows", list.length, heights, (i) => list[i].id, (range) => {
      const out = [];
      for (let i = range.start; i < range.end; i++)
        out.push(v_flex().h(heights[i]).child(this.row(list[i], i === this.sel, tier, w)).child(div().h(1).mx(SIDE).bg(K.ruleSoft)));
      return out;
    }).track_scroll(this.scroll).size_full()
      .on_item_click((id, cx) => {
        const i = list.findIndex((e) => e.id === id);
        if (i >= 0) { this.sel = i; this.selId = id; if (this.find) this.find.sel = i; }
        this.handle.focus(); cx.notify();
      });
    const body = div().relative().flex_1().min_h(0).w_full()
      .child(vlist)
      .child(Scrollbar.vertical("stage-rows").absolute().inset_0());
    // The bottom, as in Heel: a status line, then one rounded field to jump to a space (/ focuses it).
    const working = Object.values(this.byId).reduce((n, c) => n + (c.counts.working || 0), 0);
    const status = h_flex().px(SIDE + 6).pb(7).gap(10).font_family(K.mono).text_size(T.meta).text_color(K.ink3)
      .child(div().flex_none().text_color(this.error ? K.amber : K.accent).child("●"))
      .child(div().flex_1().min_w(0).truncate().child(this.error ? `couldn't read agents: ${this.error}` : !this.loaded ? "reading agents…"
        : [`${spaces().length} spaces`, this.lane && `${this.lane} needs you`, working && `${working} working`].filter(Boolean).join(" · ")))
      .when(tier !== "xs", (el) => el.child(div().flex_none().child(this.find ? "⌃n ⌃p · ↵ go · esc" : "j k · ↵ go · q")));
    const field = h_flex().mx(12).mb(12).h(42).px(16).gap(10).items_center().rounded(21).bg(K.field)
      .when(Boolean(this.find), (el) => el.border(1).border_color(K.accent))
      .child(this.find
        ? h_flex().flex_1().min_w(0).gap(1).items_center().text_size(T.field).text_color(K.ink).child(div().child(this.find.query)).child(div().w(2).h(16).bg(K.accent))
        : div().flex_1().min_w(0).truncate().text_size(T.field).text_color(K.ink3).child(tier === "xs" ? "Jump…" : "Jump to a space   /"))
      .when(Boolean(this.find), (el) => el.child(div().flex_none().font_family(K.mono).text_size(T.meta).text_color(K.ink3).child(`${list.length}`)));
    const bottom = v_flex().pt(8).border_t(1).border_color(K.rule).child(status).child(field);
    return root.when(Boolean(pin), (el) => el.child(pin)).child(body).child(bottom);
  }
}
