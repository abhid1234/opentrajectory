# OpenTrajectory Format Specification — v0.1

**Status:** Stable 0.1 (frozen 2026-06-27) · **Date:** 2026-06-22 · **License:** open (CC0 for the spec text; reference code MIT)

> **Stability promise.** v0.1 is frozen: the required fields and conformance rules (§7) will
> not change under the `0.1` `ot_version`. Future versions are **additive-only** — new optional
> fields may appear; a `0.1` document stays valid, and readers MUST ignore unknown fields
> (`additionalProperties: true`). A breaking change bumps `ot_version` (e.g. `0.2`).
> The [conformance corpus](../conformance/) and JSON Schema are the executable definition of this contract.

OpenTrajectory is an **open, vendor-neutral file format** for capturing what an AI agent actually did during one run — the ordered steps, the tool calls (name / args / result / success), the decisions, and the final outcome — in a single portable JSON artifact that any harness can emit and any evaluation tool can read.

It is **eval-first** (not telemetry): the schema centers on the fields a judge needs to diagnose *why* a run succeeded or failed. It is designed to be **OpenTelemetry-GenAI-mappable** (see Appendix A), not a competing telemetry SDK.

Every field below is traced to something a real harness emits — see `harness-emit-analysis.md`.

---

## 1. Design rules

1. **One run = one document.** A trajectory is a self-contained JSON object (or one JSON-per-line in a `.jsonl` batch). No backend required to read it.
2. **Eval-first.** Top-level `outcome` and per-step `success` exist because the reference Inspector/judge scores them. Telemetry formats omit these.
3. **Lossy-safe.** Required fields are the minimum every harness has (Section 1c table in the analysis). Everything harness-specific goes in `extensions` / `raw`, never lost, never required.
4. **Forward-versioned.** `ot_version` is mandatory; readers ignore unknown fields. Spec changes bump the version.
5. **No PII by construction note.** Capturers SHOULD redact secrets in `args`/`result`; the format provides `redacted: true` markers (Section 4).

---

## 2. Top-level object

```jsonc
{
  "ot_version": "0.1",            // REQUIRED. spec version string.
  "trajectory_id": "string",      // REQUIRED. unique id for this run.
  "harness": {                    // REQUIRED. what produced this trajectory.
    "name": "claude-code",        //   e.g. claude-code | codex-cli | antigravity | langgraph
    "version": "2.x.x"            //   OPTIONAL.
  },
  "task": {                       // OPTIONAL but recommended.
    "task_id": "string",
    "description": "string",      //   the goal / prompt the agent was given.
    "repo": "string"              //   OPTIONAL. repo or workspace identifier.
  },
  "model": "string",              // OPTIONAL. primary model id, if single-model.
  "started_at": "RFC3339",        // OPTIONAL.
  "ended_at": "RFC3339",          // OPTIONAL.
  "steps": [ Step, ... ],         // REQUIRED. ordered; see Section 3.
  "outcome": Outcome,             // REQUIRED. see Section 5.
  "cost": {                       // OPTIONAL.
    "input_tokens": 0,
    "output_tokens": 0,
    "usd": 0.0
  },
  "metadata": { },                // OPTIONAL. free-form (cwd, git_branch, session_id, …).
  "extensions": { },              // OPTIONAL. namespaced harness-specific data.
  "raw": { }                      // OPTIONAL. original record, for lossless round-trip.
}
```

## 3. Step

A `Step` is one ordered unit of agent activity. Exactly one of `message` / `tool_call` / `decision` is the step's primary payload (a step MAY also carry a `decision` alongside a `tool_call`).

```jsonc
{
  "index": 0,                     // REQUIRED. 0-based ordinal within steps[].
  "role": "assistant",            // REQUIRED. assistant | user | tool | system | subagent.
  "ts": "RFC3339",                // OPTIONAL.
  "parent_index": null,           // OPTIONAL. for branching/sub-agent trees (Claude isSidechain).
  "is_subagent": false,           // OPTIONAL. true if produced by a delegated sub-agent.

  "message": {                    // OPTIONAL. natural-language content for this step.
    "text": "string",
    "redacted": false
  },

  "tool_call": {                  // OPTIONAL. present when the step invokes a tool.
    "id": "string",               //   correlation id (maps tool_use.id / call_id).
    "name": "Bash",               // REQUIRED within tool_call.
    "args": { },                  //   structured args (object) — REQUIRED (may be {}).
    "args_text": "string",        //   OPTIONAL. raw args if not JSON-parseable.
    "result": "string",           //   OPTIONAL. result text/JSON (truncatable).
    "success": true,              // REQUIRED within tool_call. boolean.
    "error": "string",            //   OPTIONAL. error text when success=false.
    "duration_ms": 0,             //   OPTIONAL.
    "redacted": false
  },

  "decision": {                   // OPTIONAL. an explicit choice/plan the agent made.
    "text": "string",             //   e.g. "decided to edit source not test".
    "kind": "plan"                //   plan | retry | branch | give_up | other.
  }
}
```

### Mapping each harness onto a Step (traceability)

| OpenTrajectory field | Claude Code | Codex CLI | LangGraph |
|---|---|---|---|
| `role` | event `type` / message role | item role | `run_type` → role |
| `tool_call.id` | `tool_use.id` | `call_id` | run id |
| `tool_call.name` | `tool_use.name` | `function_call.name` | tool run name |
| `tool_call.args` | `tool_use.input` | `function_call.arguments` (parsed) | `inputs` |
| `tool_call.result` | `tool_result.content` | `function_call_output.output` | `outputs` |
| `tool_call.success` | `!tool_result.is_error` | implicit (no error in output) | `error == null` |
| `parent_index`/`is_subagent` | `parentUuid` / `isSidechain` | — | `parent_run_id` |
| `cost` | `message.usage` | partial | run usage |

## 4. Redaction

Capturers SHOULD redact secrets (tokens, keys, PII). When a value is removed, set the nearest `redacted: true` and replace the value with `"[REDACTED]"`. Readers MUST treat `[REDACTED]` as opaque and never infer success/failure from it.

## 5. Outcome

```jsonc
{
  "status": "success",            // REQUIRED. success | failure | partial | unknown.
  "resolved": true,               // OPTIONAL. task-level boolean (eval ground truth, if known).
  "verdict": {                    // OPTIONAL. filled by an evaluator (e.g. the reference judge), not the capturer.
    "diagnosis": "string",        //   5-class code: HARNESS | TRAINING | PRODUCT | BOTH | CLEAN (machine-stable).
    "category": "string",         //   human label, e.g. Clean | Context Gap | Reward Hack | …
    "confidence": 0.0,
    "reasoning": "string",
    "offending_step_index": null, //   0-based steps[] index that best exposes the failure.
    "evaluator": "string"         //   OPTIONAL. what produced the verdict, e.g. "opentrajectory/judge gemini-2.5-flash".
  }
}
```

> `verdict` is intentionally separate from `status`: the **capturer** sets `status`; an **evaluator** (the Inspector) fills `verdict`. This is the eval-first split that telemetry formats lack.

## 6. Batch form

A `.ot.jsonl` file holds one trajectory object per line. Tools (and the Inspector) accept either a single `.ot.json` object, a JSON array, or `.ot.jsonl`.

## 7. Conformance

A document is **conformant v0.1** if: `ot_version`, `trajectory_id`, `harness.name`, `steps`, and `outcome.status` are present; every `steps[i].index` is the 0-based position; and every `tool_call` (where present) has `name`, `args`, and `success`.

Three things enforce exactly this, kept in lockstep by a cross-check test:
- the reference validator `packages/capture/src/validate.ts` (zero-dep, used by the SDK/CLI),
- the standalone CI validator `tools/ot-validate.mjs` (zero-dep, no build — what the GitHub Action runs),
- the machine-readable **JSON Schema** `schema/opentrajectory-0.1.schema.json` (draft 2020-12), for editors and third-party tooling.

---

## Appendix A — OpenTelemetry GenAI mapping (compatibility, not competition)

OpenTrajectory is designed to coexist with OTel GenAI semantic conventions. **This mapping is shipped** — `ot to-otel <file.ot.json>` (and `toOtel()` in the SDK) converts any trajectory to an OTLP/JSON trace export you can send to any OpenTelemetry collector (Honeycomb, Grafana Tempo, Jaeger). Mapping:

| OpenTrajectory | OTel GenAI |
|---|---|
| trajectory document | one trace (root span) |
| `step` with `tool_call` | a span, `gen_ai.operation.name = "execute_tool"` |
| `tool_call.name` | `gen_ai.tool.name` |
| `harness.name` | `gen_ai.system` (or resource attr) |
| `model` | `gen_ai.request.model` |
| `cost.*_tokens` | `gen_ai.usage.input_tokens` / `output_tokens` |
| `outcome.status=failure` | span status `ERROR` |
| `outcome.verdict` | **no OTel equivalent** — OpenTrajectory's eval-first addition |

The `verdict` row is the point: OTel describes *what happened* for monitoring; OpenTrajectory adds *why it succeeded/failed* for evaluation, in a portable file. `ot to-otel` carries it through as an `opentrajectory.verdict.*` span attribute — so an OTel backend keeps the eval signal even though the core conventions have no field for it. That is the wedge: complementary to observability, not competing with it.

## Appendix B — example

A complete, conformant example trajectory ships at [`examples/hello.ot.json`](../examples/hello.ot.json) (hand-authored, validates against §7).
