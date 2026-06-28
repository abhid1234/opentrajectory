# OpenTrajectory Registry (v2 — seed)

A static, zero-dependency hub over the **harness adapters** and the **conformance corpus** — the
open, browsable face of the standard. Open `registry/index.html` in any browser; it needs no
server and no build to view.

## What it shows
- **Harness adapters** — the four that emit OpenTrajectory today (Claude Code, Codex CLI, Antigravity
  CLI verified first-hand; LangGraph/LangSmith provisional), each with its native shape + source.
- **Conformance corpus** — all nine canonical cases from [`../conformance/`](../conformance/),
  expandable to read the JSON and the invariants each one is held to.
- **Add your harness** — the PR path for contributing a new adapter + case.

## Single source of truth (no drift)
The page renders from [`data.js`](data.js), which is **generated** from the conformance manifest +
the adapter table by [`build.mjs`](build.mjs). The page can never claim something the repo doesn't ship.

```bash
node registry/build.mjs            # regenerate data.js after changing the corpus or adapters
node registry/build.mjs --check    # CI/test guard: fails if data.js is stale
```

`--check` runs in CI and the SDK test suite, so a corpus change that isn't reflected here fails the build.

## Why "v2 — seed"
v1 ships the format, SDK, corpus, and validator that make a registry *meaningful*. This static page
is the first layer of the hosted registry on the roadmap (search, side-by-side benchmark, a
submission flow) — deliberately backend-free to stay within v1's zero-dependency, vendor-neutral
constraints. It is not the funded incumbents' retraining loop; it's the open hub on top of the open format.
