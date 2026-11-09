// Who is in charge: the proxy (acts for the founder across every space) and each space's orchestrator.
// Recorded as Herdr terminal labels (`hc label <t> role=proxy|orchestrator`); everything else is an agent
// under its space's orchestrator. Pure: hosts pass terminals() and agents() as plain objects.
export function labelsOf(t) {
  const l = t?.labels;
  if (!l) return {};
  if (Array.isArray(l)) return Object.fromEntries(l.map((s) => String(s).split("=")).map(([k, ...v]) => [k, v.join("=")]));
  return l;
}

const title = (t, a) => t.name || a?.title || t.title || t.address;

// -> { proxy: {addr, name, space, status} | null, leads: { [spaceId]: [{addr, name, status}] } }
export function rolesOf(terminals, agents) {
  const where = Object.fromEntries(agents.map((a) => [a.address, a]));
  let proxy = null;
  const leads = {};
  for (const t of terminals) {
    const role = labelsOf(t).role, a = where[t.address];
    if (role === "proxy" && !proxy) proxy = { addr: t.address, name: title(t, a), space: a?.space ?? null, status: a?.status ?? t.status ?? null };
    if (role === "orchestrator" && a?.space) (leads[a.space] ??= []).push({ addr: t.address, name: title(t, a), status: a.status ?? null });
  }
  return { proxy, leads };
}
