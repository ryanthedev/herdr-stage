# herdr-stage

The stage for the Herdr desktop app: spaces as cards, what each agent needs from you, and a summary of
every agent that stops. Hexagonal: `core/` is plain JS with no Herdr, UI or Node imports; `adapters/` and
`mod/` are the hosts; skins only render the core's view-models.

- `core/` summary-on-idle rules and prompt, ask extraction (hand-offs like "#218 is waiting for you")
- `adapters/node.js` herdr-core, Claude session transcripts, the `claude` CLI summarizer, a JSON store
- `bin/summary-job.mjs` summarize agents when they go idle (`--once`, `--addr tX`); cache at
  `~/.cache/herdr-stage/summaries.json`
- `bin/eval-summary.mjs` run the ask fixtures through the real model (spends quota; run by hand)
- `core/stage.js`, `core/nav.js` the stage view-model and its keyboard behaviour (pure, tested)
- `mod/` the Herdr skin: `adapter.js` (Herdr data, git, transcripts, summary cache) and `main.js` (drawing);
  `scripts/install.sh` copies it plus `core/` into `~/.config/herdr-app/mods/stage`. Opens with cmd-g.
- `npm test` unit tests (no model calls)

Mods share one script engine, and one mod running out of memory breaks every mod until Herdr restarts,
so the adapter reads small transcript tails, one at a time, only for agents that have stopped.
