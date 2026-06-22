# OpenTrajectory

**An open, vendor-neutral format for AI agent trajectories — plus a zero-dependency capture SDK and the reference Inspector that reads and scores it.**

Every agent harness (Claude Code, Codex CLI, Gemini/Antigravity, LangGraph) already records the same spine of a run — ordered steps, tool calls (name / args / result / success), decisions, outcome — but in four mutually incompatible vocabularies, none designed for evaluation. OpenTrajectory is the one **portable file** they can all emit, and the Inspector is the validated reader that tells you *why* a run succeeded or failed.

OpenTrajectory is **eval-first**, not telemetry: it captures the fields a judge needs (per-step `success`, a top-level `outcome`, an evaluator-filled `verdict`). It is designed to be [OpenTelemetry-GenAI-mappable](docs/opentrajectory-spec.md#appendix-a--opentelemetry-genai-mapping-compatibility-not-competition), not to compete with observability plumbing.

## What's here (v1)

| Piece | Path | Status |
|---|---|---|
| **Format spec** (v0.1) + **machine-readable JSON Schema** | [`docs/opentrajectory-spec.md`](docs/opentrajectory-spec.md) · [`schema/`](schema/opentrajectory-0.1.schema.json) | ✅ |
| **CI validation** (zero-dep validator + reusable GitHub Action) | [`tools/ot-validate.mjs`](tools/ot-validate.mjs) · [`action.yml`](action.yml) | ✅ |
| **Harness-emit research + go/no-go** | [`docs/harness-emit-analysis.md`](docs/harness-emit-analysis.md) | ✅ |
| **Capture SDK + CLI** (zero-dep TS, **Claude Code + Codex** adapters + live hook) | [`packages/capture/`](packages/capture/) | ✅ 47 tests |
| **Reference judge** (zero-dep TS, fills `outcome.verdict` via Gemini) + **offline heuristic** | [`packages/capture/src/judge.ts`](packages/capture/src/judge.ts) · [`heuristic.ts`](packages/capture/src/heuristic.ts) | ✅ |
| **Judge benchmark** (labeled gold set, heuristic-vs-judge correction rate) | [`bench/`](bench/) | ✅ heuristic 11/14 |
| **Inspector reads the native format + verdict** | [`inspector/`](inspector/) | ✅ 12 tests |
| **Wedge demo + self-improvement loop demo** | [`demo/`](demo/) · [`demo/loop/`](demo/loop/) | ✅ |

v1 ships **two capture adapters — Claude Code and Codex CLI** — both verified first-hand against real on-disk sessions, both reading into one format the same Inspector audits (the cross-harness proof). Gemini/LangGraph adapters and a hosted trajectory registry are next (their emit shapes are already characterized in the analysis doc). The retraining loop is explicitly **out of scope** — that's the funded incumbents' lane (see the analysis).

## Quick start

```bash
# build the zero-dep SDK (Node built-ins only — no runtime deps, corp-airlock safe)
cd packages/capture && npm run build

# capture a real Claude Code session into an OpenTrajectory file
node dist/cli.js capture ~/.claude/projects/<slug>/<session>.jsonl -o run.ot.json
node dist/cli.js validate run.ot.json

# audit it: open inspector/index.html, click "▲ Inspect yours", drop run.ot.json
```

See [`demo/README.md`](demo/README.md) for the full live-capture-hook setup.

## Adopt it

OpenTrajectory is meant to be emitted and validated by anyone — not just this repo.

```bash
# install the SDK + CLI (zero runtime deps)
npm i -D @opentrajectory/capture        # then: npx ot validate traces/

# validate trajectories with no install at all (single self-contained file)
node tools/ot-validate.mjs traces/      # recurses for *.ot.json / *.ot.jsonl
```

**Gate conformance in CI** — drop the reusable Action into any repo:

```yaml
# .github/workflows/validate.yml
on: [push, pull_request]
jobs:
  ot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: abhid1234/opentrajectory@main   # validates *.ot.json in the repo
        with: { path: traces/ }
```

**Machine-readable schema** — point your editor or tooling at
[`schema/opentrajectory-0.1.schema.json`](schema/opentrajectory-0.1.schema.json)
(JSON Schema draft 2020-12) for autocomplete and validation. The zero-dep `ot validate`
and this schema are kept in lockstep by a cross-check test, so the runtime validator and the
published schema never drift. This repo dogfoods both on every push
([`.github/workflows/validate.yml`](.github/workflows/validate.yml)).

## CLI

```
ot capture <file.jsonl> [-o out] [--id ID] [--harness H]   capture from Claude Code OR Codex (auto-detected)
ot validate <file.ot.json|.ot.jsonl>                        conformance check (spec §7)
ot to-messages <file.ot.json> [-o out.json]                 convert to OpenAI-style messages
ot diagnose <file.ot.json>                                  offline heuristic diagnosis (no API key)
ot judge <file.ot.json> [-o out] [--model M] [--dry-run]    fill outcome.verdict via the reference judge
ot hook                                                      live PostToolUse hook (reads stdin)
```

### The reference judge

`ot judge` is the open format's reference evaluator. It reads a `.ot.json`, runs the RL
Trajectory Auditor's validated **4-point diagnostic** (HARNESS / TRAINING / PRODUCT / BOTH /
CLEAN) over the native steps, and writes the result into `outcome.verdict` — which the
Inspector then shows as the LLM-judge column next to the in-browser heuristic. It reuses the
auditor's judge taxonomy (it does not reinvent the judge), is zero-dependency (Node built-in
`fetch`), and sends the trajectory to Gemini (`GEMINI_API_KEY`; the key rides the
`x-goog-api-key` header, never the URL).

```bash
ot judge run.ot.json --dry-run          # preview the exact prompt + cost estimate, no API call
GEMINI_API_KEY=… ot judge run.ot.json   # fills outcome.verdict in place
```

> Judging sends the (capture-time-redacted) trajectory to an external LLM — inherent to any
> LLM judge. Use `--dry-run` to see exactly what would be sent. See
> [`examples/hello-judged.ot.json`](examples/hello-judged.ot.json) for the output shape.

**Is the evaluator trustworthy?** Don't take it on faith — [`bench/`](bench/) is a labeled gold
set that scores the heuristic (offline) and the judge (with a key) and reports how many of the
heuristic's mistakes the judge corrects. Today the offline heuristic scores **11/14**, missing
exactly the ambiguous reward-hack cases an LLM that reads the trace is meant to catch. And
[`demo/loop/`](demo/loop/) shows a diagnosis driving one full self-improvement turn
(fail → diagnose HARNESS → fix the harness → pass).

## Tests

```bash
# SDK (validators, both adapters, redaction, round-trip, hook, heuristic, judge) — 51 tests
cd packages/capture && node --import tsx test/run.ts
# Inspector ingestion path (native OT, both harnesses, Context-Gap diagnosis) — 12 tests, plain node
node inspector/test-ingest.mjs
# Judge benchmark — heuristic accuracy now; add --judge with a key
node --import tsx bench/score.ts
```

## Design principles

- **One run = one self-contained JSON file.** No backend required to read it.
- **Lossy-safe.** Required fields are the minimum every harness has; harness-specific data goes in `extensions`/`raw`, never lost, never required.
- **Eval-first.** `outcome.status` (set by the capturer) and `outcome.verdict` (filled by an evaluator) are first-class — the split telemetry formats lack.
- **Redaction by construction.** The capturer redacts secrets (tokens, keys) and marks `redacted: true`.

## Relationship to the RL Trajectory Auditor / Inspector

OpenTrajectory builds **on** the shipped [RL Trajectory Auditor](https://github.com/abhid1234/rl-trajectory-auditor) — it does not rebuild the judge. The Inspector here is that project's Explorer, extended so its `normalizeLocal()` ingestion detects and reads the native OpenTrajectory format directly. OpenTrajectory adds the two layers the Auditor lacked: **live cross-harness capture** and **an open portable format**.

## License

Spec text: CC0. Reference code: MIT.
