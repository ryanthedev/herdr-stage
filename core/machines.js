// Machine tabs: Stage shows every space, or only the spaces of one machine. Pure: hosts pass plain objects.
//
// A tab is "*" (all machines), "" (this computer: spaces whose machine is null) or a machine name.

export const ALL = "*", HERE = "";

// The tabs to offer, in order: All, this computer (when it has spaces), then the other machines by name.
// No tabs at all when every space is on one machine: there is nothing to choose between.
export function machineTabs(spaces) {
  const names = new Set(spaces.map((s) => s.machine ?? HERE));
  if (names.size < 2) return [];
  const others = [...names].filter((n) => n !== HERE).sort((a, b) => a.localeCompare(b));
  return [ALL, ...(names.has(HERE) ? [HERE] : []), ...others];
}

export const onTab = (tab, space) => tab === ALL || (space.machine ?? HERE) === tab;

// The tab after (dir 1) or before (dir -1) `cur`, wrapping. An unknown `cur` (its machine went away) starts at All.
export function nextTab(tabs, cur, dir) {
  if (!tabs.length) return ALL;
  const i = tabs.indexOf(cur);
  if (i < 0) return ALL;
  return tabs[(i + dir + tabs.length) % tabs.length];
}

// The display list narrowed to one tab. A space whose parent is on another tab moves to the top level,
// so it never draws a nesting line to a row that isn't there.
export function onlyTab(entries, tab) {
  if (tab === ALL) return entries;
  const kept = entries.filter((e) => onTab(tab, e.space));
  const ids = new Set(kept.map((e) => e.id));
  return kept.map((e) => (e.parent && !ids.has(e.parent) ? { ...e, depth: 0, parent: null } : e));
}
