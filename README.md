# OpenTrajectory

**An open, vendor-neutral format for AI agent trajectories — plus a zero-dependency capture SDK and the reference Inspector that reads and scores it.**

Every agent harness (Claude Code, Codex CLI, Gemini/Antigravity, LangGraph) already records the same spine of a run — ordered steps, tool calls (name / args / result / success), decisions, outcome — but in four mutually incompatible vocabularies, none designed for evaluation. OpenTrajectory is the one **portable file** they can all emit, and the Inspector is the validated reader that tells you *why* a run succeeded or failed.

OpenTrajectory is **eval-first**, not telemetry: it captures the fields a judge needs (per-step `success`, a top-level `outcome`, an evaluator-filled `verdict`). It is designed to be [OpenTelemetry-GenAI-mappable](docs/opentrajectory-spec.md#appendix-a--opentelemetry-genai-mapping-compatibility-not-competition), not to compete with observability plumbing.

## What's here (v1)

| Piece | Path | Status |
|---|---|---|
| **Format spec** (v0.1) | [`docs/opentrajectory-spec.md`](docs/opentrajectory-spec.md) | ✅ |
| **Harness-emit research + go/no-go** | [`docs/harness-emit-analysis.md`](docs/harness-emit-analysis.md) | ✅ |
| **Capture SDK + CLI** (zero-dep TS, Claude Code adapter + live hook) | [`packages/capture/`](packages/capture/) | ✅ 23 tests |
| **Inspector reads the native format** | [`inspector/`](inspector/) | ✅ 8 tests |
| **Wedge demo** (live run → emit → audit) | [`demo/`](demo/) | ✅ |

v1 = Claude Code adapter only. Codex / Gemini / LangGraph adapters and a hosted trajectory registry are v2 (the emit shapes are already characterized in the analysis doc). The retraining loop is explicitly **out of scope** — that's the funded incumbents' lane (see the analysis).

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

## CLI

```
ot capture <transcript.jsonl> [-o out.ot.json] [--id ID]   capture from a Claude Code transcript
ot validate <file.ot.json|.ot.jsonl>                        conformance check (spec §7)
ot to-messages <file.ot.json> [-o out.json]                 convert to OpenAI-style messages
ot hook                                                      live PostToolUse hook (reads stdin)
```

## Tests

```bash
# SDK (validator, parser, redaction, round-trip, hook) — 23 tests
cd packages/capture && node --import tsx test/run.ts
# Inspector ingestion path (native OT -> Context-Gap diagnosis) — 8 tests, plain node
node inspector/test-ingest.mjs
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
