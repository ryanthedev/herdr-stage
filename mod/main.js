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
import { tierFor, rowView, rowHeight, fitFor, ROW_GAP, THUMB_W, META_W } from "./core/rows.js";
import { track, prune, rank } from "./core/order.js";
import { parentsOf, families, labelsOf } from "./core/nest.js";
import { search, nextSearch } from "./core/search.js";
import { tokens } from "./themes.js";

const MOD = "stage";
const T = { tiny: 11, cap: 12, sm: 13, body: 14, name: 18 };
const MONO = "SF Mono";
const PAD = 10, SLACK = 14; // SLACK: room for the scrollbar
const THUMB_PREVIEW = { xl: 74, l: 54 }; // 6 and 4 lines of 11px

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

  // "2 your move · 1 working · 3 idle · 1 dashboard"; `brief` keeps only what needs you or is moving.
  counts(k, c, live, brief) {
    const part = (n, label, color, ring) => h_flex().flex_none().gap(4).items_center()
      .child(ring ? div().size(6).rounded(3).border(1).border_color(color) : div().size(6).rounded(3).bg(color))
      .child(div().text_color(color).child(`${n} ${label}`));
    const parts = [];
    if (c?.counts.move) parts.push(part(c.counts.move, "your move", k.move));
    if (c?.counts.working) parts.push(part(c.counts.working, "working", k.working));
    if (!brief) {
      if (c?.counts.idle) parts.push(part(c.counts.idle, "idle", k.muted, true));
      const quiet = (n, one, many) => n ? [div().flex_none().text_color(k.muted).font_weight(500).child(`${n} ${n > 1 ? many : one}`)] : [];
      parts.push(...quiet(c?.counts.mods, "dashboard", "dashboards"), ...quiet(c?.counts.procs, "process", "processes"), ...quiet(c?.counts.shells, "shell", "shells"));
    }
    if (!parts.length && !brief) parts.push(div().text_color(k.idle).child(c ? "empty" : live.status ?? ""));
    return h_flex().gap(9).min_w(0).overflow_hidden().text_size(T.tiny).font_weight(600).children(parts);
  }

  // An item's state mark: a filled dot for asks and working agents, a ring for idle, a square for dashboards.
  mark(k, i) {
    if (i.kind === "mod") return div().size(8).flex_none().rounded(2).border(1).border_color(k.nestText ?? k.focus);
    if (i.kind === "shell" || i.kind === "process") return div().size(7).flex_none().rounded(4).border(1).border_color(k.idle);
    const color = i.move ? k.move : i.state === "working" ? k.working : i.state === "done" ? k.done : null;
    return color ? div().size(7).flex_none().rounded(4).bg(color) : div().size(7).flex_none().rounded(4).border(1).border_color(k.idle);
  }

  // What an item is doing, in one line: its ask, its status line, or where it runs.
  sub(i) { return i.move ?? i.line ?? (i.kind === "mod" ? "dashboard" : i.detail ?? ""); }

  // A thumbnail: a tiny view of the item's screen (or its dashboard name) above its label and status.
  thumb(k, i, tier, preview) {
    const ask = Boolean(i.move), screen = i.screen ?? [];
    const scr = !preview ? null : i.kind === "mod"
      ? div().h(THUMB_PREVIEW[tier]).flex().items_center().justify_center().bg(k.card2).text_size(T.tiny).font_weight(600).text_color(k.ink2).child(i.label)
      : v_flex().h(THUMB_PREVIEW[tier]).px(6).py(4).overflow_hidden().bg(k.inset ?? k.bg).font_family(MONO).text_size(8).line_height("11px").text_color(k.ink2)
        .children(screen.slice(tier === "xl" ? -6 : -4).map((l) => div().h(11).flex_none().truncate().child(l || " ")));
    return v_flex().w(THUMB_W[tier]).flex_none().rounded(7).overflow_hidden().border(1).border_color(ask ? k.moveLine : k.line).bg(k.card)
      .when(Boolean(scr), (el) => el.child(scr).child(div().h(1).bg(k.border)))
      .child(v_flex().px(7).py(5).gap(1).min_w(0)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(this.mark(k, i))
          .child(div().flex_1().min_w(0).truncate().text_size(T.cap).text_color(k.ink).child(i.label))
          .when(Boolean(i.at), (el) => el.child(div().flex_none().text_size(10).text_color(k.idle).child(ago(i.at)))))
        .child(div().truncate().text_size(T.tiny).text_color(ask ? k.moveRow : k.muted).child(this.sub(i))));
  }

  // A chip (middle tier): mark + label; an ask chip also carries its ask and takes the row's width.
  chip(k, i) {
    if (i.move) return v_flex().flex_1().min_w(0).px(9).py(4).rounded(7).bg(k.moveBg).border(1).border_color(k.moveLine)
      .child(h_flex().gap(6).items_center().child(this.mark(k, i)).child(div().flex_1().min_w(0).truncate().text_size(T.cap).text_color(k.ink).child(i.label))
        .child(div().flex_none().text_size(10).text_color(k.idle).child(ago(i.at))))
      .child(div().truncate().text_size(T.tiny).text_color(k.moveRow).child(i.move));
    return h_flex().flex_none().max_w(160).gap(6).items_center().px(9).py(4).rounded(999).border(1).border_color(k.line)
      .child(this.mark(k, i)).child(div().min_w(0).truncate().text_size(T.cap).text_color(k.ink2).child(i.label));
  }

  // The name block: name (search hits lit), HERE, nested crumb, folder and branch, counts.
  meta(k, e, c, tier) {
    const live = e.space, branch = live.branch ?? (c?.facts.find((f) => f.startsWith("⎇")) ?? "").replace("⎇ ", "");
    const parentName = e.parent ? spaces().find((s) => s.id === e.parent)?.name : null;
    const where = [parentName && `↳ ${parentName}`, c?.facts[0], tier !== "m" && branch && `⎇ ${branch}`].filter(Boolean).join("  ·  ");
    return v_flex().min_w(0).gap(2)
      .child(h_flex().gap(8).items_center().min_w(0)
        .child(this.dot(k, c, live))
        .child(this.title(k, live.name, e.hits))
        .when(e.kids > 0, (el) => el.child(div().flex_none().text_size(T.tiny).text_color(k.nestText).child(`+${e.kids}`)))
        .when(live.active, (el) => el.child(this.here(k))))
      .child(div().truncate().text_size(T.tiny).text_color(k.muted).child(where))
      .child(div().mt(4).child(this.counts(k, c, live, false)));
  }

  dot(k, c, live) {
    const color = c?.counts.move ? k.move : c?.counts.working || live.status === "working" ? k.working : live.status === "blocked" ? k.blocked : null;
    return color ? div().size(8).flex_none().rounded(4).bg(color) : div().size(8).flex_none().rounded(4).border(1).border_color(k.idle);
  }

  // The name, with the characters a search matched drawn in the focus colour.
  title(k, name, hits, size = T.body + 1) {
    const s = k.caps ? name.toUpperCase() : name;
    if (!hits?.length) return div().flex_1().min_w(0).truncate().text_size(size).font_weight(k.headWeight).text_color(k.head).child(s);
    const on = new Set(hits), segs = [];
    for (let i = 0; i < s.length; i++) {
      const m = on.has(i), last = segs[segs.length - 1];
      if (last && last.m === m) last.t += s[i]; else segs.push({ m, t: s[i] });
    }
    return h_flex().flex_1().min_w(0).overflow_hidden().text_size(size).font_weight(k.headWeight)
      .children(segs.map((g) => div().flex_none().text_color(g.m ? k.focus : k.head).child(g.t)));
  }

  here(k) { return div().flex_none().px(6).py(1).rounded(999).bg(tint(k.focus, 0x20, k.selBg)).text_size(10).font_weight(700).text_color(k.focus).child("HERE"); }

  // One space as a full-width row, at the pane's tier. `on`: the keyboard selection.
  row(k, e, on, tier, w) {
    const live = e.space, c = this.byId[live.id], move = Boolean(c?.hasMove);
    const v = rowView(c, tier, fitFor(tier, w));
    const indent = e.depth ? Math.min(3, e.depth) * (tier === "xs" || tier === "s" ? 12 : 18) : 0;
    const box = (tier === "s" || tier === "xs" ? v_flex().px(10).py(7).gap(3) : tier === "m" ? v_flex().px(12).py(9).gap(8) : h_flex().px(12).py(9).gap(14).items_center())
      .h(rowHeight(c, tier)).ml(indent).flex_1().min_w(0).rounded(9).overflow_hidden().relative()
      .bg(on ? k.cardSelected : move ? k.cardUrgent : k.card).border(on ? 2 : 1).border_color(on ? k.focus : move ? k.moveLine : k.line)
      .when(move && !on, (el) => el.child(div().absolute().left(0).top(10).bottom(10).w(3).rounded(2).bg(k.move)))
      .when(Boolean(c?.loose), (el) => el.border_dashed());
    if (tier === "s" || tier === "xs") {
      const line = h_flex().gap(8).items_center().min_w(0)
        .child(this.dot(k, c, live)).child(this.title(k, live.name, e.hits, T.body))
        .when(live.active, (el) => el.child(this.here(k)))
        .child(div().flex_none().child(this.counts(k, c, live, tier === "xs")));
      return h_flex().w_full().child(box.child(line)
        .when(Boolean(v.ask), (el) => el.child(div().pl(16).truncate().text_size(T.tiny).text_color(k.moveRow).child(v.ask.move))));
    }
    const more = v.more > 0 ? [div().flex_none().self_center().text_size(T.tiny).text_color(k.idle).child(`+${v.more}`)] : [];
    if (tier === "m") return h_flex().w_full().child(box.child(this.meta(k, e, c, tier))
      .child(h_flex().gap(6).min_w(0).overflow_hidden().children([...v.items.map((i) => this.chip(k, i)), ...more])));
    return h_flex().w_full().child(box
      .child(div().w(META_W[tier] - (indent ? 18 : 0)).flex_none().child(this.meta(k, e, c, tier)))
      .child(h_flex().flex_1().min_w(0).gap(8).overflow_hidden().children([...v.items.map((i) => this.thumb(k, i, tier, v.preview(i))), ...more])));
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
    const k = tokens(theme(), "default");
    this.presence(false);
    const tier = tierFor(this.width || 640), w = this.width || 640;
    // The space you're in is pinned above the list (not while searching), so the list leaves it out.
    const all = this.find ? this.found() : this.shown();
    const pinned = this.find ? null : all.find((e) => e.space.active);
    const list = pinned ? all.filter((e) => e !== pinned) : all;
    if (this.find) this.find.sel = Math.max(0, Math.min(this.find.sel, list.length - 1));
    const at = this.selId ? list.findIndex((e) => e.id === this.selId) : -1;
    this.sel = this.find ? this.find.sel : at >= 0 ? at : Math.max(0, Math.min(this.sel, list.length - 1));
    const rows = list.map((_, i) => [i]);
    const heights = list.map((e) => rowHeight(this.byId[e.id], tier) + ROW_GAP);
    const root = v_flex().id(`stage-${this.uid}`).track_focus(this.handle).size_full().bg(k.bg).text_color(k.ink)
      // Sizes arrive multiplied by the app's zoom; layout math is in the mod's own px.
      .on_size_change((size, cx) => {
        const z = Number(settings().zoom) || 1, nw = size.width / z, was = this.width ? tierFor(this.width) : null;
        if (Math.abs(nw - this.width) > 2) {
          this.width = nw; cx.notify();
          // First size, or crossing into a thumbnail tier: fetch screen previews now, not at the next tick.
          if (["xl", "l"].includes(tierFor(nw)) && !["xl", "l"].includes(was)) this.refresh(cx);
        }
      })
      .on_key_down((e, cx) => this.key(e, list, rows, cx));
    const narrow = tier === "s" || tier === "xs";
    const header = h_flex().px(16).pt(14).pb(10).gap(10).items_center()
      .child(div().text_size(T.name).font_weight(700).text_color(k.head).child(k.caps ? "STAGE" : "Stage"))
      .when(!narrow, (el) => el.child(div().text_size(T.cap).text_color(k.muted).child(`${spaces().length} spaces`)))
      .child(div().flex_1())
      .when(this.lane > 0, (el) => el.child(h_flex().flex_none().gap(6).items_center().px(9).py(3).rounded(999).bg(tint(k.move, 0x22, k.moveBg))
        .child(div().size(6).rounded(3).bg(k.move))
        .child(div().text_size(T.cap).font_weight(700).text_color(k.move).child(narrow ? `${this.lane}` : `${this.lane} waiting on you`))));
    const prompt = this.find && h_flex().mx(PAD).mb(6).px(12).py(8).gap(8).items_center().rounded(9)
      .bg(k.card).border(1).border_color(k.focus)
      .child(div().text_size(T.body).font_weight(700).text_color(k.focus).child("/"))
      .child(div().text_size(T.body).text_color(k.ink).child(this.find.query))
      .child(div().w(2).h(16).bg(k.focus))
      .child(div().flex_1())
      .child(div().text_size(T.tiny).text_color(k.muted).child(`${list.length} match${list.length === 1 ? "" : "es"}`));
    const pin = pinned && div().px(PAD).pb(8).border_b(1).border_color(k.border).mb(6).child(this.row(k, { ...pinned, depth: 0 }, false, tier, w));
    const vlist = v_virtual_list("stage-rows", list.length, heights, (i) => list[i].id, (range) => {
      const out = [];
      for (let i = range.start; i < range.end; i++)
        out.push(div().h(heights[i]).px(PAD).pb(ROW_GAP).child(this.row(k, list[i], i === this.sel, tier, w)));
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
    const foot = div().px(16).py(7).border_t(1).border_color(k.border).text_size(T.tiny).text_color(k.muted).truncate()
      .child(this.error ? `Couldn't read agents: ${this.error}` : !this.loaded ? "Reading agents…" : this.find ? "type to filter · ⌃n ⌃p move · ↵ go · esc back" : narrow ? "j k · / · ↵ · q" : "j k move · / search · ↵ go to space · q close");
    return root.child(header).when(Boolean(prompt), (el) => el.child(prompt)).when(Boolean(pin), (el) => el.child(pin)).child(body).child(foot);
  }
}
