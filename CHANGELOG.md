# Changelog

All notable changes to OpenTrajectory. The **format** is versioned by `ot_version` (spec §7);
the **SDK/CLI** by the `@opentrajectory/capture` package version.

## v0.1.0 — 2026-06-27 (v1 scope complete; format frozen)

First complete release: the open, vendor-neutral trajectory **format** + a zero-dependency
**capture SDK** + the reference **Inspector** that reads and scores it. The `0.1` format is now
**stable/frozen** — additive-only from here (a breaking change bumps `ot_version`).

### Format & standard
- **Spec v0.1** (`docs/opentrajectory-spec.md`) — vendor-neutral schema: ordered steps, tool
  calls (name/args/result/success), decisions, eval-first `outcome` (capturer `status` +
  evaluator `verdict`), redaction by construction. Now marked **Stable/frozen** with an
  additive-only stability promise.
- **Machine-readable JSON Schema** (`schema/opentrajectory-0.1.schema.json`, draft 2020-12),
  kept in lockstep with the runtime validator by a cross-check test.
- **Conformance corpus** (`conformance/`) — 9 canonical documents + a "validate-your-adapter"
  guide + a rot-proof `check.mjs` (manifest invariants, no orphans). The seed of the registry.
- **Zero-dep CI validator** (`tools/ot-validate.mjs`) + **reusable GitHub Action** (`action.yml`).

### Capture SDK + CLI (`@opentrajectory/capture`, zero runtime deps)
- **Four harness adapters:** Claude Code, Codex CLI, Antigravity CLI (all verified first-hand against
  real on-disk sessions) + **LangGraph/LangSmith** (provisional — built from the documented
  run-tree shape; handles the three real export shapes: nested `child_runs`, `dotted_order`-
  ordered flat lists, and `parent_run_id`-linked flat lists; reconstructs tree order).
- **Live capture hook** (`ot hook`) — emits one OpenTrajectory step per Claude Code `PostToolUse`.
- **CLI** — `capture`, `validate`, `to-messages`, `to-otel`, `diagnose`, `judge`, `hook`.
- **OpenTelemetry bridge** (`ot to-otel`) — `.ot.json` → OTLP/JSON GenAI spans (complementary to
  observability, not competing).
- **Redaction by construction** — secrets replaced with `[REDACTED]` + `redacted: true`.

### Evaluation (builds ON the RL Trajectory Auditor — does not rebuild the judge)
- **Reference judge** (`ot judge`, zero-dep, Gemini) fills `outcome.verdict` via the auditor's
  validated 4-point diagnostic (HARNESS / TRAINING / PRODUCT / BOTH / CLEAN); **offline heuristic**
  (`ot diagnose`) needs no API key.
- **Judge benchmark** (`bench/`) — labeled 24-case set surfaced a real PRODUCT→TRAINING bias; a
  principled prompt fix took the judge 17→24/24 in-sample and **13/14 held-out** (bias did not
  recur), with a second blind spot (fixture/snapshot gaming) found and closed.

### Inspector + demos
- **Inspector reads the native format** — `normalizeLocal()` detects `ot_version` + `steps` and
  ingests OpenTrajectory directly (3 harnesses side by side); 15 ingestion tests.
- **Wedge demo** recorded as a reproducible asciinema cast (`demo/wedge.cast`, off a sanitized
  fixture) + **self-improvement loop demo** (`demo/loop/`) — diagnoses steering a converging
  HARNESS → PRODUCT → CLEAN loop.

### Tests
99 SDK tests · 15 Inspector tests · 9-case conformance corpus · CI dogfoods validation on every push.

### Out of scope (by design)
The retraining loop (trajectory → SFT/RL → retrain — the funded incumbents' lane) and a hosted
registry UI (v2 — groundwork laid by the conformance corpus).
