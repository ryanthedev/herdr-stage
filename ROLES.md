# Roles and teams (one rule for every Herdr tool)

Owner: **the founder (the user)**. This file is the single source of truth. Heel, herdr-stage, the relay
and any other tool read it; none of them redefine it. To change the rule, change this file first.

Written 2026-11-09 from the relay's description of the convention and the live labels
(`hc get t5s t5x t5v t5d`). Nothing here depends on herdr-core's `parent` field.

## The rule

1. **A space is a team.** Every agent whose `herdr.space` label names a space is on that space's team.
2. **The leader is the agent labelled `role=orchestrator`** in that space. One per space.
   - None: the team has no leader; show its agents flat.
   - More than one: the oldest (earliest `created_ms`) leads; tools show a small warning.
3. **`role=proxy` is infrastructure, not a team member** (today: the relay, `t5d`). Tools show it under
   its own space but never as a leader or as part of another space's team.
4. **No label means a plain team member.** Optional `role=<anything else>` (for example `role=qa`) is a
   display hint only and never changes who leads.
5. **Never use `parent`.** Herdr treats a parented terminal as a pane-less helper, and `parent` can't be
   set after start; it is null on every live agent.

## Setting and fixing roles

- At start: `hc run --label role=orchestrator ...`
- Later (labels can change after start): `hc label <t> role=orchestrator` or `hc label <t> role=proxy`.
- Moving the lead: label the new leader first, then remove the label from the old one.

## What tools do with it

| Tool | Uses the rule for |
|---|---|
| Heel (iPhone) | Overview: the leader's bubble stands for the team, team members' requests surface first. Space view: leader on top, team indented. Terminal header: "in <leader>'s team" |
| herdr-stage | Sub-spaces / team grouping (replaces nesting by space name) |
| Relay | Knows it is `role=proxy`; routes to a space's orchestrator |
