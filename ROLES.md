# Who is in charge (roles in Herdr)

Two roles, recorded as Herdr terminal labels. The Stage pane (cmd-g) shows them.

| Role | Who | Label |
|---|---|---|
| Proxy | The one agent that acts for the founder across every space (today: relay) | `hc label <t> role=proxy` |
| Orchestrator | The lead agent of one space; directs the agents in that space | `hc label <t> role=orchestrator` |

Every other agent has no role label. It belongs to the orchestrator of the space it sits in.

## Rules for whoever starts agents
- **One space per orchestrator.** The orchestrator is the space's first tab and its agents are the next tabs, so the space alone says who leads them.
- **Label right after starting:** `hc label <t> role=orchestrator` (or `role=proxy`). Clear it with `hc label <t> role=`.
- **Relabel after every restart.** A `--resume` into a new terminal gets a new address and no labels.
- **Exactly one proxy.** If two terminals carry `role=proxy`, Stage shows the first one.
- **Don't use `parent`.** Herdr and Stage treat a terminal with a parent as a sub-agent helper without its own pane, and a parent can't be set after a start.

## What Stage shows
- **Top of the pane:** "Proxy: <name> · <address> · <status>", with "go" to jump to it, or "none labelled".
- **Each space row:** "led by <name> · <address>", or "no orchestrator". The space the proxy sits in also says "proxy lives here".
