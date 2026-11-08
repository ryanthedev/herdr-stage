# herdr-stage

The stage for the Herdr desktop app: spaces as cards, what each agent needs from you, and a summary of
every agent that stops. Hexagonal: `core/` is plain JS with no Herdr, UI or Node imports; `adapters/` and
`mod/` are the hosts; skins only render the core's view-models.

- `core/` summary-on-idle rules and prompt, ask extraction (hand-offs like "#218 is waiting for you")
- `adapters/node.js` herdr-core, Claude session transcripts, the `claude` CLI summarizer, a JSON store
- `bin/summary-job.mjs` summarize agents when they go idle (`--once`, `--addr tX`); cache at
  `~/.cache/herdr-stage/summaries.json`
- `bin/eval-summary.mjs` run the ask fixtures through the real model (spends quota; run by hand)
- `npm test` unit tests (no model calls)
