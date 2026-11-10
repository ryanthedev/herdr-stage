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
import { theme, layout, run, spaces, panes, focused, nextCommand, settings, terminals, agents, shared, setShared, readTextFile, appHome, exec, hc, props } from "herdr";
import { gather } from "./adapter.js";
import { buildStage } from "./core/stage.js";
import { nextGrid } from "./core/grid.js";
import { tierFor, rowView, rowHeight, statusOf, slotW, ROW, SIDE, BUBBLE_GAP } from "./core/rows.js";
import { track, prune, rank } from "./core/order.js";
import { parentsOf, families, spaceIdOf } from "./core/nest.js";
import { search, nextSearch } from "./core/search.js";
import { MISSION as K, machineColor } from "./themes.js";
import { Help } from "./help/help.js";
import { SCAN, LIST, parseScan, machineRows, folderRows, startRows, nextOpen } from "./core/open.js";

const MOD = "stage";

// Stage's keys for the ? overlay (herdr-help, ~/repos/herdr-help). Keep in step with key(), findKey() and
// core/open.js nextOpen().
const KEYS = [
  ["MOVE", [["j k", "next / previous space"], ["↓ ↑", "the same"], ["g G", "first / last space"], ["Enter", "go to that space"], ["q", "close Stage"]]],
  ["FIND A SPACE", [["/", "filter by name, machine, folder, branch, agents"], ["⌃n ⌃p", "next / previous match (or arrows)"], ["Enter", "go there"], ["⌃u", "clear the filter"], ["Esc", "back to the list"]]],
  ["NEW SPACE", [["n", "new space: machine, then folder, then what to start"], ["Enter", "next step; on the last, open the space"], ["Tab →", "show a folder's subfolders"], ["~/x /x", "type a path to use it (made if missing)"], ["Esc", "back a step"]]],
  ["ANYWHERE", [["⌘G", "open Stage beside you, or focus it (keys.json)"], ["?", "these keys"]]],
];
// Heel's overview type: name 16/600, status 12, mono meta 10, bubble title 13.5/600, message 12.5.
const T = { meta: 10, msg: 13, title: 13.5, status: 12, name: 16, field: 14 };
// Motion is costly: every Herdr redraw repaints the whole window, so anything that animates sets the window's
// frame rate. A .loop() runs at ~30 fps and held Herdr at ~25% CPU (measured 2026-11-09, ~3% without it).
// So Stage animates only with .frames() on one shared, slow tick (~2 redraws a second, ~+2% CPU).
const TICK = 500;
const HOURGLASS = ["", "", ""];
const SCANNING = ["scanning for repos", "scanning for repos.", "scanning for repos..", "scanning for repos..."];

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
    this.keysHelp = new Help(KEYS, { title: "Stage keys", mod: MOD });
    // Docked: a layout block ({"mod": "stage", "props": {"dock": true}}) rather than a pane. It stays up
    // across tabs and spaces, so it must not take the keyboard when it starts (that would pull focus off
    // your terminal at every launch and reload); pane.go (cmd-h/l) brings the keyboard to it instead.
    this.dock = Boolean(props()?.dock);
    if (!this.dock) {
      this.handle.focus();
      cx.timer.after(60, () => { this.handle.focus(); this.watchFocus(cx); });
    }
    // cmd-g in a tab that already shows a stage: this new copy hands focus to that one and closes itself.
    if (!this.dock) cx.timer.after(40, () => {
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
        // A dock is not a pane, so panes() can't say it's the target; "focus" reaching it is the signal.
        cx.timer.after(60, () => { if (this.dock || panes().find((p) => p.focused)?.mod === MOD) this.handle.focus(); this.watchFocus(cx); cx.notify(); });
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
        // {"help": true | "filter words"}: the ? key list, optionally filtered.
        if (seam?.help) { this.keysHelp.open(cx); if (typeof seam.help === "string") this.keysHelp.st = { q: seam.help, typing: false, y: 0 }; }
        // {"open": {"step": "folder", "machine": "ska", "query": ""}}: the new-space picker at a step.
        if (seam?.open) {
          this.startOpen(cx);
          Object.assign(this.open, seam.open);
          if (seam.open.step !== "machine") this.scanFolders(seam.open.machine ?? null, cx);
        }
        // {"parents": {"child space name": "parent space name"}}: nesting without labelling real terminals.
        if (seam?.parents && typeof seam.parents === "object") { this.seamParents = seam.parents; this.reorder(); cx.notify(); }
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

  go(sp, cx) {
    if (!sp) return;
    run("space.select", { id: sp.id });
    if (this.dock) this.handBack(cx, sp.id);
  }

  // Docked, Enter and Esc give the keyboard back to the space's focused pane, the way leaving a pane would.
  // After Enter that must be the *new* space's pane: focusing the pane that was focused when Enter was
  // pressed selects its space again, undoing the switch. So wait until the switch has landed (up to ~1 s)
  // and hand back to whatever is focused then; if it never lands, leave the keyboard where it is.
  handBack(cx, spaceId = null, tries = 12) {
    const f = focused();
    if (spaceId && f?.space !== spaceId) {
      if (tries > 0) cx.timer.after(80, () => this.handBack(cx, spaceId, tries - 1));
      return;
    }
    if (f?.pane) run("pane.focus", { pane: f.pane });
  }

  // GPUI tells a plain element nothing when it loses the keyboard, and moving it to or from a dock changes no
  // pane, so while Stage holds the keyboard it looks again every TICK and redraws once when that ends (the
  // selection band must not linger). A look that finds nothing changed draws nothing.
  watchFocus(cx) {
    if (this.watching) return;
    this.watching = true;
    const look = () => cx.timer.after(TICK, () => {
      if (this.handle.is_focused()) return look();
      this.watching = false;
      cx.notify();
    });
    look();
  }

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
    const where = (t) => spaceIdOf(t, agentSpace);
    this.parent = parentsOf(terminals().filter((t) => t.state === "live"), sp, where);
    const idOf = (name) => sp.find((s) => s.name === name)?.id;
    for (const [child, par] of Object.entries(this.seamParents ?? {})) if (idOf(child) && idOf(par)) this.parent[idOf(child)] = idOf(par);
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

  // The status word after a space's name, with its dot: accent "needs you", mint "working", sage "done".
  // A space's status as an icon chip, no words: Nerd Font glyphs (your font is a Nerd Font) in the status
  // colour on a faint tint of it. Pink bell = needs you, mint hourglass (turning) = working, sage check = done,
  // grey moon = idle, grey ring = empty.
  status(c, live) {
    const word = statusOf(c, live.status);
    const [glyph, color] = ({ "needs you": ["\uf0f3", this.need], working: ["\uf251", K.accent], done: ["\uf00c", K.done],
      idle: ["\uf186", K.ink3], empty: ["\uf10c", K.ink3] })[word] ?? ["\uf10c", K.ink3];
    const icon = div().text_color(color).child(glyph);
    return h_flex().flex_none().h(ROW.meta).w(26).justify_center().items_center().rounded(5).bg(color + "26")
      .child(word === "working" ? div().text_color(color).frames(HOURGLASS, TICK) : icon);
  }

  // The line under the name: where the space lives as two chips (branch, folder), then nested-under and the
  // rest as quiet labelled counts.
  metaLine(e, c, live, more = 0) {
    const branch = live.branch ?? (c?.facts.find((f) => f.startsWith("⎇")) ?? "").replace("⎇ ", "");
    const parentName = e.parent ? spaces().find((s) => s.id === e.parent)?.name : null;
    const n = (v, one, many) => (v ? `${v} ${v > 1 ? many : one}` : null);
    const folder = c?.facts[0] && !c.facts[0].startsWith("⎇") ? c.facts[0] : null;
    const folderName = folder ? folder.split("/").filter(Boolean).pop() || folder : null;
    const chip = (glyph, text) => h_flex().flex_none().h(ROW.meta).px(7).gap(5).items_center().rounded(5).bg(K.chip)
      .child(div().text_color(K.ink3).child(glyph))
      .child(div().max_w(220).truncate().text_color(K.ink2).child(text));
    // Everything else on the line is a chip too, each with its icon: nested-under, the space's other panes,
    // its nested spaces, and how many items didn't fit as bubbles.
    const counts = [
      parentName && ["\uf148", `under ${parentName}`],
      n(c?.counts.idle, "idle", "idle") && ["\uf186", n(c?.counts.idle, "idle", "idle")],
      n(c?.counts.mods, "dashboard", "dashboards") && ["\uf0e4", n(c?.counts.mods, "dashboard", "dashboards")],
      n(c?.counts.shells, "shell", "shells") && ["\uf489", n(c?.counts.shells, "shell", "shells")],
      n(c?.counts.procs, "process", "processes") && ["\uf013", n(c?.counts.procs, "process", "processes")],
      e.kids && ["\uf0e8", `${e.kids} nested`],
      more && ["\uf141", `${more} more`],
    ].filter(Boolean);
    return h_flex().h(ROW.meta).gap(6).items_center().min_w(0).overflow_hidden().font_family(this.font).text_size(T.meta)
      .child(this.status(c, live))
      .when(Boolean(branch), (el) => el.child(chip("\ue725", branch)))
      // The folder chip only when it says something the name doesn't.
      .when(Boolean(folderName) && folderName !== live.name, (el) => el.child(chip("\uf07b", folderName)))
      .children(counts.map(([glyph, text]) => chip(glyph, text)));
  }

  // What a bubble says, up to three lines: the ask, else the agent's recap or last message, else what it is.
  message(i) {
    if (i.move) return i.move;
    const flat = (s) => String(s ?? "").replace(/\*\*|__|`|^#+\s*/gm, "").replace(/\s*\n+\s*/g, " ").trim();
    if (i.kind === "agent") return flat(i.recap) || flat(i.text).slice(0, 320) || i.line || "";
    return i.detail ?? i.kind;
  }

  // One item as a message bubble: title with its age on the right, then up to three lines of message.
  // An ask is the same bubble with its message in full ink.
  bubble(i, w) {
    const need = Boolean(i.move);
    const title = i.kind === "agent" ? i.title || i.label : i.label;
    return v_flex().w(w).h(ROW.bubble).flex_none().px(12).py(10).gap(4).overflow_hidden()
      .rounded_tl(16).rounded_tr(16).rounded_br(16).rounded_bl(6).bg(K.surface)
      .child(h_flex().flex_none().h(19).gap(8).items_center().min_w(0)
        .child(div().flex_1().min_w(0).truncate().text_size(T.title).font_weight(600).text_color(K.title).child(title || ""))
        .when(Boolean(i.at), (el) => el.child(div().flex_none().font_family(this.font).text_size(T.meta).text_color(K.ink3).child(ago(i.at)))))
      // An ask reads in full-strength ink; other messages are secondary ink. No edge bar (the user found it ugly).
      // Message text in a reading sans (SF Pro Text), not the mono font the rest of Stage uses.
      .child(div().h(51).overflow_hidden().font_family(K.read).text_size(T.msg).line_height("17px").text_color(need ? K.ink : K.ink2).child(this.message(i)));
  }

  // Which machine a remote space lives on: a server icon and the machine's name in that machine's colour,
  // right after the space name so it reads before anything else. Spaces on this computer get none.
  machine(name) {
    const color = machineColor(name);
    return h_flex().flex_none().h(22).px(8).gap(6).items_center().rounded(6).bg(color + "2E")
      .border(1).border_color(color + "99").font_family(this.font).text_size(T.status).font_weight(600)
      .child(div().text_color(color).child("\uf233"))
      .child(div().max_w(140).truncate().text_color(color).child(name));
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
  // `on`: the keyboard selection, shown only while this pane has the keyboard, as a steady tint behind the row
  // (not a pulse: see TICK).
  row(e, on, tier, w) {
    const live = e.space, c = this.byId[live.id], v = rowView(c, tier, w);
    const indent = e.depth ? Math.min(3, e.depth) * 16 : 0, bw = slotW(tier, w, indent);
    const head = h_flex().gap(8).items_center().min_w(0)
      .child(this.title(live.name, e.hits))
      .when(Boolean(live.machine), (el) => el.child(this.machine(live.machine)))
      // Too narrow for the chip line (xs): the status icon sits after the name instead.
      .when(tier === "xs", (el) => el.child(this.status(c, live)))

      .child(div().flex_1());
    const body = v_flex().h(rowHeight(c, tier)).w_full().pl(SIDE + indent).pr(SIDE).justify_center().relative()
      .when(on, (el) => el.child(div().absolute().inset_0().bg(K.sel)))
      .when(Boolean(e.depth), (el) => el.child(div().absolute().left(SIDE + indent - 10).top(0).h(22).w(1).bg(K.rule))
        .child(div().absolute().left(SIDE + indent - 10).top(22).w(6).h(1).bg(K.rule)))
      .child(head);
    if (tier === "xs") return body;
    return body.child(div().mt(4).child(this.metaLine(e, c, live, v.more)))
      .when(v.bubbles.length > 0, (el) => el.child(h_flex().mt(ROW.gap).gap(BUBBLE_GAP).min_w(0).overflow_hidden()
        .children(v.bubbles.map((i) => this.bubble(i, bw)))));
  }

  key(e, list, rows, cx) {
    // ? opens the key list, except while typing a filter or a path (there ? is a character).
    if ((this.keysHelp.shown || (!this.find && !this.open)) && this.keysHelp.key(e, cx)) return;
    if (this.open) return this.openKey(e, cx);
    if (this.find) return this.findKey(e, list, cx);
    if (e.key === "n" && !e.modifiers?.platform && !e.modifiers?.control) { this.startOpen(cx); cx.stop_propagation(); return cx.notify(); }
    if (e.key === "/") { this.find = { query: "", sel: 0 }; this.scroll.scroll_to_item(0); cx.stop_propagation(); return cx.notify(); }
    if (e.modifiers?.platform || e.modifiers?.control) return; // cmd-h/l etc. stay the app's
    const before = this.sel;
    const r = nextGrid(this.sel, e.key, rows, Boolean(e.modifiers?.shift));
    this.sel = r.sel;
    this.selId = list[this.sel]?.id ?? null;
    if (this.sel !== before) this.scroll.scroll_to_item(this.sel);
    if (r.effect?.open !== undefined) this.go(list[r.effect.open]?.space, cx);
    if (r.effect?.close) {
      if (this.dock) this.handBack(cx);
      else { const me = panes().find((p) => p.focused && p.mod === MOD); if (me) run("pane.close", { pane: me.pane }); }
    }
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
    if (r.effect?.open !== undefined) { this.find = null; this.selId = pick?.id ?? this.selId; this.go(pick?.space, cx); }
    if (r.effect?.close) { this.find = null; if (pick) this.selId = pick.id; }
    cx.stop_propagation(); cx.notify();
  }

  // New space picker (n, or the + by the field): machine, then folder, then what to start. The lists and
  // keys are core/open.js; here we read machines, scan folders on the chosen machine, and run space.new.
  startOpen(cx) {
    this.open = { step: "machine", query: "", sel: 0 };
    this.find = null;
    cx.spawn(async (cx) => {
      try { this.openMachines = JSON.parse((await hc(["machine", "ls", "--json"])).stdout).machines ?? []; }
      catch { this.openMachines = []; }
      cx.notify();
    });
  }

  // Folders your spaces on that machine already use (their folder and their terminals' folders).
  spaceFolders(machine) {
    const ps = panes(), out = [];
    for (const s of spaces().filter((s) => (s.machine ?? null) === (machine ?? null))) {
      const tabs = new Set(s.tabs.map((t) => t.id));
      out.push(s.folder, ...ps.filter((p) => tabs.has(p.tab)).map((p) => p.cwd));
    }
    return [...new Set(out.filter((f) => typeof f === "string" && f.startsWith("/")))];
  }

  openRows() {
    const o = this.open, sc = this.openScan;
    if (o.step === "machine") return machineRows(this.openMachines ?? [], o.query);
    if (o.step === "folder") return folderRows({ home: sc?.home, repos: sc?.repos ?? [], dirs: sc?.dirs ?? [], extra: sc?.extra ?? [], spaceFolders: this.spaceFolders(o.machine) }, o.query);
    return startRows(sc?.status === "ready" ? sc.have : null, o.query);
  }

  scanFolders(machine, cx) {
    const scan = { machine, status: "loading", home: null, have: [], dirs: [], extra: [] };
    this.openScan = scan;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", SCAN], { on: machine, timeout: 60000 });
        Object.assign(scan, parseScan(r.stdout), { status: "ready" });
      } catch (e) { Object.assign(scan, { status: "error", error: String(e?.message ?? e) }); }
      cx.notify();
    });
  }

  expandFolder(path, cx) {
    const scan = this.openScan;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", LIST, "sh", path], { on: scan?.machine, timeout: 15000 });
        const kids = r.stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/"));
        if (scan) scan.extra = [...new Set([...scan.extra, ...kids])];
      } catch {}
      cx.notify();
    });
  }

  // A typed folder that isn't there yet is made first (space.new refuses a folder that doesn't exist).
  createSpace(args, typed, cx) {
    this.open = null;
    cx.spawn(async (cx) => {
      if (typed) { try { await exec("mkdir", ["-p", args.folder], { on: args.machine || null }); } catch {} }
      run("space.new", args);
      cx.notify();
    });
  }

  openAct(r, rows, cx) {
    const picked = rows[this.open.sel] ?? null, step = this.open.step; // the row Enter was on, before the step changed
    this.open = r.st;
    if (r.effect?.close) this.open = null;
    if (r.effect && "scan" in r.effect) this.scanFolders(r.effect.scan, cx);
    if (r.effect?.expand) this.expandFolder(r.effect.expand, cx);
    if (r.effect?.create) this.createSpace(r.effect.create, this.openTyped, cx);
    if (step === "folder" && r.st.step === "start") this.openTyped = picked?.kind === "typed";
    cx.notify();
  }

  openKey(e, cx) {
    if (e.modifiers?.platform) return;
    const rows = this.openRows();
    this.openAct(nextOpen(this.open, e.key, rows, { control: Boolean(e.modifiers?.control) }), rows, cx);
    cx.stop_propagation();
  }

  // The picker, in place of the list: where you are in the three steps, then the rows (a window around
  // the selection, so it never needs scrolling).
  openView(w) {
    const o = this.open, rows = this.openRows(), sc = this.openScan;
    o.sel = Math.max(0, Math.min(o.sel, rows.length - 1));
    const tilde = (p) => (sc?.home && p?.startsWith(sc.home) ? "~" + p.slice(sc.home.length) : p);
    const where = o.machine ? this.machine(o.machine) : o.step !== "machine" ? h_flex().gap(6).items_center().text_size(T.status).text_color(K.ink2).child("\uf109").child("This computer") : null;
    const ask = { machine: "Which machine?", folder: "Which folder?", start: "Start what?" }[o.step];
    const head = v_flex().px(SIDE).pt(14).pb(10).gap(8)
      .child(h_flex().gap(10).items_center().min_w(0)
        .child(div().flex_none().text_size(T.name).font_weight(600).text_color(K.ink).child("New space"))
        .when(Boolean(where), (el) => el.child(where))
        .when(Boolean(o.folder) && o.step === "start", (el) => el.child(h_flex().min_w(0).h(22).px(8).gap(6).items_center().rounded(6).bg(K.chip)
          .child(div().text_color(K.ink3).child("\uf07b")).child(div().min_w(0).truncate().text_size(T.status).text_color(K.ink2).child(tilde(o.folder))))))
      .child(h_flex().gap(8).items_center().text_size(T.status).text_color(K.ink3)
        .child(div().text_color(K.title).font_weight(600).child(ask))
        .when(o.step === "folder" && sc?.status === "loading", (el) => el.child(div().frames(SCANNING, TICK)))
        .when(o.step === "folder" && sc?.status === "error", (el) => el.child(div().text_color(this.need).truncate().child(`couldn't scan: ${sc.error}`)))
        .when(o.step === "machine" && !this.openMachines, (el) => el.child(div().child("reading machines…"))));
    const N = 40, start = Math.max(0, Math.min(o.sel - Math.floor(N / 2), rows.length - N));
    const tag = (text, color) => div().flex_none().px(6).h(18).flex().items_center().rounded(4).bg(color + "26").text_size(T.meta).text_color(color).child(text);
    const line = (r, i) => {
      const on = i === o.sel;
      const el = h_flex().id(`open-${o.step}-${i}`).h(32).px(SIDE - 8).mx(8).gap(10).items_center().rounded(8).min_w(0).cursor_pointer()
        .when(on, (el) => el.bg(K.raised)).when(!on, (el) => el.hover((s) => s.bg(K.surface)))
        .on_click((_e, cx) => { o.sel = i; this.openAct(nextOpen(o, "enter", rows), rows, cx); });
      if (o.step === "machine") return el
        .child(r.machine ? this.machine(r.machine) : h_flex().gap(8).items_center().text_size(T.status + 1).text_color(K.ink).child(div().text_color(K.ink3).child("\uf109")).child(r.label))
        .when(Boolean(r.note), (el) => el.child(div().text_size(T.meta).text_color(r.off ? this.need : K.ink3).child(r.note)));
      if (o.step === "folder") return el
        // A repo shows the git glyph; a plain folder the folder glyph; a typed path a plus.
        .child(div().flex_none().w(14).text_color(r.kind === "typed" ? K.accent : r.kind === "repo" ? K.title : K.ink3)
          .child(r.kind === "typed" ? "\uf067" : r.kind === "repo" ? "\ue725" : "\uf07b"))
        .child(div().flex_1().min_w(0).truncate().font_family(this.font).text_size(T.status + 1).text_color(on ? K.ink : K.ink2).child(r.label))
        .when(r.kind === "space", (el) => el.child(tag("has a space", K.accent)))
        .when(r.kind === "typed", (el) => el.child(tag("use this path", K.accent)));
      const glyph = { claude: "\uf4b8", codex: "\uf121", shell: "\uf489" }[r.id] ?? "\uf120";
      return el.child(div().flex_none().w(16).text_color(K.title).child(glyph))
        .child(div().flex_1().min_w(0).truncate().text_size(T.status + 1).text_color(on ? K.ink : K.ink2).child(r.label));
    };
    const list = v_flex().flex_1().min_h(0).overflow_hidden().gap(2)
      .children(rows.slice(start, start + N).map((r, k) => line(r, start + k)))
      .when(rows.length === 0, (el) => el.child(div().px(SIDE).py(8).text_size(T.status).text_color(K.ink3)
        .child(o.step === "folder" ? "No match. Type a path starting with ~/ or / to use it." : "No match.")));
    return v_flex().flex_1().min_h(0).w_full().child(head).child(list);
  }

  // Search results: every card that matches all words, best first, flat (no families).
  found() {
    const all = this.shown(), byId = Object.fromEntries(all.map((e) => [e.id, e]));
    const cards = all.map((e) => {
      const c = this.byId[e.id];
      return { id: e.id, fields: [
        { key: "name", text: e.space.name, weight: 2 },
        { key: "where", text: [e.space.machine, c?.facts[0], e.space.branch].filter(Boolean).join(" ") },
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
    const pinned = this.find || this.open ? null : all.find((e) => e.space.active);
    const list = pinned ? all.filter((e) => e !== pinned) : all;
    if (this.find) this.find.sel = Math.max(0, Math.min(this.find.sel, list.length - 1));
    const at = this.selId ? list.findIndex((e) => e.id === this.selId) : -1;
    this.sel = this.find ? this.find.sel : at >= 0 ? at : Math.max(0, Math.min(this.sel, list.length - 1));
    const rows = list.map((_, i) => [i]);
    // Highlight only while this pane has the keyboard; otherwise nothing is selected-looking.
    // Reading panes() here also redraws the pane when focus moves elsewhere (it is live data).
    const active = this.handle.is_focused() && (this.dock || panes().find((p) => p.focused)?.mod === MOD);
    const heights = list.map((e) => rowHeight(this.byId[e.id], tier) + 1); // + the hairline between rows
    // Your Herdr font (settings "font", e.g. BerkeleyMono Nerd Font) for everything, like the terminals.
    this.font = String(settings().font || settings().font_family || K.mono);
    // The same ground as your terminals: the theme's terminal background at the layout's terminal_opacity,
    // so whatever the layout paints behind panes shows through Stage exactly as it does through a terminal.
    this.need = K.need;
    // Herdr stacks two layers at that opacity under a terminal (measured: a terminal shows the square of what
    // one layer shows), so Stage paints their combined cover, 1 - (1 - op)^2, to match.
    const op = Math.max(0, Math.min(1, Number(layout()?.terminal_opacity ?? settings().terminal_opacity ?? 1)));
    const ground = tint(theme().background, Math.round((1 - (1 - op) ** 2) * 255), K.bg);
    const root = v_flex().id(`stage-${this.uid}`).relative().track_focus(this.handle).size_full().bg(ground).text_color(K.ink).font_family(this.font)
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
        out.push(v_flex().h(heights[i]).child(this.row(list[i], active && i === this.sel, tier, w)).child(div().h(1).mx(SIDE).bg(K.ruleSoft)));
      return out;
    }).track_scroll(this.scroll).size_full()
      .on_item_click((id, cx) => {
        const i = list.findIndex((e) => e.id === id);
        if (i >= 0) { this.sel = i; this.selId = id; if (this.find) this.find.sel = i; }
        this.handle.focus(); this.watchFocus(cx); cx.notify();
      });
    const body = this.open ? this.openView(w) : div().relative().flex_1().min_h(0).w_full()
      .child(vlist)
      .child(Scrollbar.vertical("stage-rows").absolute().inset_0());
    // The bottom, as in Heel: a status line, then one rounded field to jump to a space (/ focuses it).
    const working = Object.values(this.byId).reduce((n, c) => n + (c.counts.working || 0), 0);
    const status = h_flex().px(SIDE + 6).pb(7).gap(10).font_family(this.font).text_size(T.meta).text_color(K.ink3)
      .child(div().flex_none().text_color(this.error ? this.need : K.accent).child("●"))
      .child(div().flex_1().min_w(0).truncate().child(this.error ? `couldn't read agents: ${this.error}` : !this.loaded ? "reading agents…"
        : [`${spaces().length} spaces`, this.lane && `${this.lane} needs you`, working && `${working} working`].filter(Boolean).join(" · ")))
      .when(tier !== "xs", (el) => el.child(div().flex_none().child(this.open ? (this.open.step === "folder" ? "↵ next · tab/→ inside · esc back" : "↵ next · esc back")
        : this.find ? "⌃n ⌃p · ↵ go · esc" : "j k · ↵ go · n new · ? keys")));
    // While picking a new space the field is that step's filter; its placeholder says what to type.
    const typing = this.open ?? this.find;
    const hint = this.open ? { machine: "Type to filter machines", folder: "Filter, or type a path: ~/src/new", start: "Claude, Codex or a shell" }[this.open.step] : "";
    const field = h_flex().mx(12).mb(12).h(42).px(16).gap(10).items_center().rounded(21).bg(K.field)
      .when(Boolean(typing), (el) => el.border(1).border_color(K.accent))
      .child(typing
        ? h_flex().flex_1().min_w(0).gap(1).items_center().text_size(T.field).text_color(K.ink)
          .when(!typing.query && Boolean(hint), (el) => el.child(div().w(2).h(16).bg(K.accent)).child(div().pl(4).truncate().text_color(K.ink3).child(hint)))
          .when(Boolean(typing.query) || !hint, (el) => el.child(div().child(typing.query)).child(div().w(2).h(16).bg(K.accent)))
        : div().flex_1().min_w(0).truncate().text_size(T.field).text_color(K.ink3).child(tier === "xs" ? "Jump…" : "Jump to a space   /"))
      .when(Boolean(this.find), (el) => el.child(div().flex_none().font_family(this.font).text_size(T.meta).text_color(K.ink3).child(`${list.length}`)))
      // New space: the same picker as n.
      .when(!typing, (el) => el.child(h_flex().id("stage-new").flex_none().h(28).px(10).gap(6).items_center().rounded(14).bg(K.chip).cursor_pointer()
        .text_size(T.status).text_color(K.ink2).child(div().text_color(K.accent).child("\uf067")).when(tier !== "xs", (el) => el.child("New space"))
        .on_click((_e, cx) => { this.startOpen(cx); this.handle.focus(); this.watchFocus(cx); cx.notify(); })));
    const bottom = v_flex().pt(8).border_t(1).border_color(K.rule).child(status).child(field);
    const help = this.keysHelp.panel({ bg: K.bg, surface: K.surface, border: K.rule, ink: K.ink, ink2: K.ink2, dim: K.ink3, accent: K.accent, warn: K.need, font: this.font, mono: this.font });
    return root.when(Boolean(pin), (el) => el.child(pin)).child(body).child(bottom).when(Boolean(help), (el) => el.child(help));
  }
}
