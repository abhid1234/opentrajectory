# OpenTrajectory

**An open, vendor-neutral format for AI agent trajectories — plus a zero-dependency capture SDK and the reference Inspector that reads and scores it.**

Every agent harness (Claude Code, Codex CLI, Gemini/Antigravity, LangGraph) already records the same spine of a run — ordered steps, tool calls (name / args / result / success), decisions, outcome — but in four mutually incompatible vocabularies, none designed for evaluation. OpenTrajectory is the one **portable file** they can all emit, and the Inspector is the validated reader that tells you *why* a run succeeded or failed.

OpenTrajectory is **eval-first**, not telemetry: it captures the fields a judge needs (per-step `success`, a top-level `outcome`, an evaluator-filled `verdict`). It is designed to be [OpenTelemetry-GenAI-mappable](docs/opentrajectory-spec.md#appendix-a--opentelemetry-genai-mapping-compatibility-not-competition), not to compete with observability plumbing.

## What's here (v1)

| Piece | Path | Status |
|---|---|---|
| **Format spec** (v0.1) + **machine-readable JSON Schema** | [`docs/opentrajectory-spec.md`](docs/opentrajectory-spec.md) · [`schema/`](schema/opentrajectory-0.1.schema.json) | ✅ |
| **CI validation** (zero-dep validator + reusable GitHub Action) | [`tools/ot-validate.mjs`](tools/ot-validate.mjs) · [`action.yml`](action.yml) | ✅ |
| **OpenTelemetry bridge** (`.ot.json` → OTLP/JSON GenAI spans) | [`packages/capture/src/to-otel.ts`](packages/capture/src/to-otel.ts) | ✅ |
| **Harness-emit research + go/no-go** | [`docs/harness-emit-analysis.md`](docs/harness-emit-analysis.md) | ✅ |
| **Capture SDK + CLI** (zero-dep TS, **Claude Code + Codex + Gemini** adapters + LangGraph + live hook) | [`packages/capture/`](packages/capture/) | ✅ 93 tests |
| **Reference judge** (zero-dep TS, fills `outcome.verdict` via Gemini) + **offline heuristic** | [`packages/capture/src/judge.ts`](packages/capture/src/judge.ts) · [`heuristic.ts`](packages/capture/src/heuristic.ts) | ✅ |
| **Judge benchmark** (24-case set; surfaced a judge bias → drove a prompt fix) | [`bench/`](bench/) | ✅ heuristic 18/24 · judge 17→24/24 (in-sample) |
| **Inspector reads the native format + verdict** (3 harnesses side by side) | [`inspector/`](inspector/) | ✅ 15 tests |
| **Wedge demo + self-improvement loop demo** | [`demo/`](demo/) · [`demo/loop/`](demo/loop/) | ✅ |

v1 ships **four capture adapters**: Claude Code, Codex CLI, and Gemini CLI — all verified first-hand against real on-disk sessions — plus **LangGraph/LangSmith**, built from the documented run-tree schema and exercised with synthetic fixtures (flagged provisional, not yet validated against a real export). All read into one format the same Inspector audits (the cross-harness proof). A hosted trajectory registry is next. The retraining loop is explicitly **out of scope** — that's the funded incumbents' lane (see the analysis).

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

**Already on OpenTelemetry?** Pipe trajectories straight into your existing stack — no new backend:

```bash
ot to-otel run.ot.json | curl -X POST -H "Content-Type: application/json" -d @- \
  http://localhost:4318/v1/traces     # any OTLP/HTTP collector (Honeycomb, Grafana Tempo, Jaeger)
```

Each run becomes a trace: a root `invoke_agent` span + an `execute_tool` span per tool call
(`gen_ai.tool.name`, status `ERROR` on failure). OpenTrajectory's eval-first `verdict` rides
along as an `opentrajectory.verdict.*` attribute that core OTel has no field for — **complementary
to observability, not competing with it.**

**Machine-readable schema** — point your editor or tooling at
[`schema/opentrajectory-0.1.schema.json`](schema/opentrajectory-0.1.schema.json)
(JSON Schema draft 2020-12) for autocomplete and validation. The zero-dep `ot validate`
and this schema are kept in lockstep by a cross-check test, so the runtime validator and the
published schema never drift. This repo dogfoods both on every push
([`.github/workflows/validate.yml`](.github/workflows/validate.yml)).

## CLI

```
ot capture <file> [-o out] [--id ID] [--harness H]         capture from Claude Code / Codex / Gemini / LangGraph (auto-detected)
ot validate <file.ot.json|.ot.jsonl>                        conformance check (spec §7)
ot to-messages <file.ot.json> [-o out.json]                 convert to OpenAI-style messages
ot to-otel <file.ot.json> [-o out.json]                     convert to OpenTelemetry GenAI spans (OTLP/JSON)
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

**Is the evaluator trustworthy? (measured, and improved by the measurement.)** Don't take it on
faith — [`bench/`](bench/) scores both on a labeled 24-case set (Gemini 2.5 Flash judge). The
benchmark drove a real fix:

| | accuracy | corrects heuristic's misses |
|---|---|---|
| offline heuristic | **18/24 (75.0%)** | — |
| judge — original prompt | 17/24 (70.8%) | 5 of 6 |
| judge — after a principled prompt fix | **24/24 (100%)** | **6 of 6** |

The bench first exposed a systematic bias: the judge over-called genuine capability failures
(`PRODUCT`) as reward-hacking (`TRAINING`), landing it *below* the cheap heuristic. The fix was a
**principled** prompt sharpening — define each class and add "a failing run is NOT automatically
TRAINING; *tried-and-wrong* = PRODUCT, *couldn't-run* = HARNESS" — not memorizing the cases it
missed. That took the judge to 24/24.

**Held-out validation** (14 *new* cases the prompt fix never saw):

| | accuracy | PRODUCT→TRAINING bias |
|---|---|---|
| offline heuristic | 8/14 (57.1%) | — |
| judge — current prompt, **held-out** | **13/14 (92.9%)** | **did not recur** (5/5 PRODUCT correct) |

The fix **generalizes** — the bias is gone on fresh cases, not memorized. A held-out run then
exposed a *second* blind spot (fixture/snapshot gaming); adding that as a general category and
verifying on a **fresh** variant, the judge now catches it too. The one remaining miss is
genuinely ambiguous (a blanket `jest -u` after a refactor — legitimate as often as not), flagged
rather than forced. The arc — **measure → find bias → principled fix → in-sample 24/24 → held-out
13/14, second blind spot found and closed** — is the whole point: **a measurable evaluator is one
you can actually debug and improve**, which an opaque score is not. And
[`demo/loop/`](demo/loop/) shows diagnoses steering a multi-turn self-improvement loop that
**converges** — same task, three turns, each failing for a different reason
(HARNESS → PRODUCT → CLEAN), the diagnosis naming the lever each time.

## Tests

```bash
# SDK (validators, 4 adapters, redaction, round-trip, hook, heuristic, judge, otel) — 93 tests
cd packages/capture && node --import tsx test/run.ts
# Inspector ingestion path (native OT, 3 harnesses, diagnosis) — 15 tests, plain node
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
