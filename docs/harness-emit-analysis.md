# Phase 0 — Harness emit analysis + go/no-go

**Date:** 2026-06-22
**Question:** What do real agent harnesses emit at runtime, and does an open, vendor-neutral, cross-harness *trajectory capture* standard already exist? If the niche is open, what is the honest wedge for OpenTrajectory?

**Method:** Claude Code findings are **ground truth** — captured directly from a live transcript on this machine (`~/.claude/projects/<slug>/<session>.jsonl`) and the running hook config (`~/.claude/settings.json`). The other harnesses are characterized from their documented/observed formats. Where a claim is not first-hand verified, it is marked *(unverified)*.

---

## 1. What each harness emits at runtime

### 1a. Claude Code — VERIFIED (first-hand, this machine)

Two independent capture surfaces:

**(A) Transcript JSONL** — one event per line at `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`. Verified event `type` values seen: `user`, `assistant`, `attachment`, `file-history-snapshot`, `last-prompt`, `mode`, `permission-mode`.

Envelope keys on each turn event: `uuid`, `parentUuid` (forms a turn DAG), `timestamp`, `sessionId`, `cwd`, `gitBranch`, `version`, `userType`, `isSidechain` (true = sub-agent), `requestId`.

A **tool call** is a content block inside an `assistant` message:
```json
{"type":"tool_use","id":"toolu_017H…","name":"Bash",
 "input":{"command":"gh repo clone …","description":"…"}}
```
A **tool result** is a content block inside the *next* `user` message, plus a `toolUseResult` sidecar on the envelope:
```json
{"type":"tool_result","tool_use_id":"toolu_017H…",
 "content":"(Bash completed with no output)","is_error":false}
```
Assistant messages also carry `message.usage` (input/output/cache tokens, per-iteration) and `message.model`, `stop_reason`. So Claude Code already records, per step: **tool name, structured args, result text, success/error flag, token cost, model, ordering (via parentUuid), and sub-agent boundary (isSidechain).** That is nearly the full OpenTrajectory field set — it just isn't named or portable.

**(B) Hooks (live tap)** — `~/.claude/settings.json` wires `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `Notification`. A `PostToolUse` hook receives a JSON object on **stdin** with (documented): `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, and `tool_response`. This is the *live, in-flight* capture point — the SDK can emit an OpenTrajectory step the instant each tool returns, without post-hoc parsing.

> **Implication for OpenTrajectory:** Claude Code is the ideal first adapter. The transcript gives a reliable post-hoc source; the `PostToolUse` hook gives live capture. v1 capture SDK targets both.

### 1b. OpenAI Codex CLI — VERIFIED (first-hand, this machine) · adapter SHIPPED

Codex CLI (v0.80.0) persists **session "rollout" files** as JSONL under `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`. Each line is `{timestamp, type, payload}`. Verified top-level `type` values: `session_meta` (one; `{id, cwd, cli_version, instructions}`), `response_item` (the trajectory spine), `event_msg` (UI events incl. the clean `user_message`), `turn_context`.

The spine is in `type:"response_item"`, whose `payload.type` is one of:
- **`message`** — `{role:"user"|"assistant", content:[{type:"input_text"|"output_text", text}]}`
- **`function_call`** — `{name, arguments (JSON string), call_id}`
- **`function_call_output`** — `{call_id, output}` where `output` begins `Exit code: N\n…` (N=0 ⇒ success — the success signal)
- **`reasoning`** — encrypted/empty; skipped.

So Codex emits the same *spine* (ordered turns + tool calls + outputs) in OpenAI's Responses-item vocabulary; per-step success is recoverable from the `Exit code:` prefix. The shipped adapter (`packages/capture/src/from-codex.ts`) pairs `function_call`/`function_call_output` by `call_id`, reads success from the exit code, and emits `harness.name = "codex-cli"`. **Verified on a real 141-line rollout → 24-step conformant OpenTrajectory file**, read by the same Inspector as Claude Code (the cross-harness proof).

### 1c. Gemini CLI — VERIFIED (first-hand, this machine) · adapter SHIPPED · (Antigravity characterized)

- **Gemini CLI** writes each chat as a **single JSON session object** at `~/.gemini/tmp/<hash>/chats/session-*.json`: `{ sessionId, startTime, lastUpdated, messages[] }`. Verified `messages[].type` values: `user`, `gemini` (assistant), `info` (UI notices, skipped). A `gemini` message may carry `toolCalls[]` = `{ id, name, args, result }` where `result` is `[{ functionResponse: { response: { output | error } } }]` (success = no `error`), plus a `tokens` object `{ input, output, cached, thoughts, tool, total }`. So Gemini emits the same spine in *yet another* shape — and unlike Codex (JSONL), the whole session is one JSON document. The shipped adapter (`packages/capture/src/from-gemini.ts`) maps it to `harness.name = "gemini-cli"`, recovers per-tool success from `response.error`, and sums tokens into `cost`. **Verified on real sessions, from a 6-step run up to a 1008-message session → 1858 conformant steps.** (Gemini also supports OTel export — observability-shaped spans, complementary to this portable artifact; OpenTrajectory now bridges the other way via `ot to-otel`.)
- **Antigravity** (Google's agentic IDE) surfaces "Artifacts"/task trajectories in its own UI but exposes **no documented, vendor-neutral trajectory file format**. Capture would lean on the OTel export or UI artifacts.

### 1d. LangGraph / LangChain (+ LangSmith) — *(from documented schema)* · adapter SHIPPED (unverified)

LangChain/LangGraph runs are modeled as a **run tree**: each node is a `Run` with `run_type` (`llm` | `chat_model` | `tool` | `chain` | `retriever`), `inputs`, `outputs`, `start_time`/`end_time`, `error`, `parent_run_id`, and either nested `child_runs` or a flat list keyed by parent. This is the richest native model of the four — explicit error and parent fields — but it is **observability-first and tied to the LangSmith backend**. The shipped adapter (`packages/capture/src/from-langgraph.ts`) flattens both export shapes (nested DFS or flat sorted by `start_time`), maps `tool` runs → tool_calls (success from `error == null`), `llm`/`chat_model` runs → assistant messages, and the root `chain` → task; emits `harness.name = "langgraph"`.

> **Honesty:** unlike the other three adapters, this one is **not first-hand verified** — there was no real LangGraph session on the build machine, so it's built from the documented LangSmith run shape and exercised with synthetic fixtures only. Treat it as provisional until validated against a real export.

### Cross-harness summary

| Harness | On-disk artifact | Tool call shape | Explicit success? | Cost/tokens | Portable open format? |
|---|---|---|---|---|---|
| **Claude Code** | transcript JSONL + hooks | `tool_use`/`tool_result` blocks | yes (`is_error`) | yes (`usage`) | no — **adapter shipped** |
| **Codex CLI** | `rollout-*.jsonl` | Responses `function_call`(+`_output`) | via `Exit code:` | partial | no — **adapter shipped** |
| **Gemini CLI** | session JSON (`messages[]`) | `toolCalls[]` (+`functionResponse`) | via `response.error` | yes (`tokens`) | no — **adapter shipped** |
| **LangGraph** | LangSmith run tree | `Run(run_type=tool)` | yes (`error`) | yes | no — **adapter shipped (unverified)** |

**Every harness records the same spine — ordered steps, tool name, args, result, (usually) success — in four mutually incompatible vocabularies, none of which is a portable artifact designed for evaluation.** That incompatibility is the gap OpenTrajectory fills.

---

## 2. Does an open cross-harness *capture standard* already exist?

This is the make-or-break question. The honest distinction: **telemetry/observability spans** (built to ship to an APM/monitoring backend) vs. **a portable trajectory FILE that an agent emits and an eval tool reads.** OpenTrajectory is the latter.

- **OpenTelemetry GenAI semantic conventions** — the most serious candidate. Defines `gen_ai.*` span attributes and events for model calls and (increasingly) agent/tool spans. **But:** (1) it is *span/telemetry-shaped*, designed to flow into observability backends, not to be a self-contained eval artifact; (2) the **agent & tool conventions are still experimental/Development-stage** (as of early 2026) and evolving; (3) it deliberately does **not** define an outcome/verdict layer for evaluation. It is the one thing that could eventually absorb this niche — so OpenTrajectory must be *complementary and OTel-mappable*, not a competitor to OTel.
- **OpenInference (Arize Phoenix)** — semantic conventions over OTel spans for LLM/agent. Same telemetry shape; Arize-adjacent; not a neutral portable artifact.
- **AgentOps / Langfuse / Helicone** — vendor SDKs + hosted backends, each with its own schema. Useful, not neutral standards.
- **"Agent trajectory" eval datasets** (SWE-rebench, AgentBench rows, OpenAI-style `messages`) — these are *eval input shapes*, per-dataset, not a live cross-harness capture standard. (The shipped RL Trajectory Auditor already reads these.)

**Verdict on the niche:** No project today offers *(open) + (vendor-neutral) + (live cross-harness capture) + (eval-first portable artifact) + (registry)* together. OTel GenAI is adjacent but observability-shaped and still experimental. The wedge is **open and unclaimed — provided OpenTrajectory positions as eval-first and OTel-compatible, not as another telemetry SDK.**

---

## 3. Closed incumbents (confirm we stay out of their lane)

- **Trajectory.ai** — ~$15M raise (May 2026; Jeff Dean / Fei-Fei Li named; customers Decagon/Clay/Harvey/Mercor/Rogo). Closed product centered on the **trajectory → SFT/RL → retrain** loop. No open capture format published for others to adopt.
- **Braintrust** — ~$80M evals platform. Proprietary; its trace format is its own product surface, not a neutral standard.

Neither ships an open, adopt-anywhere capture format. We do **not** touch the retraining loop (their funded core). Our lane = open capture + format + Inspector-reads-it.

---

## 4. Go / No-Go

**Decision: GO**, with the wedge sharpened by this research.

**Honest verdict:** The "open cross-harness trajectory capture standard" niche is genuinely unclaimed *as a portable, eval-first artifact*. The only real risk to that claim is OpenTelemetry's GenAI conventions — which are observability-shaped and still experimental, and which we should **align with rather than fight**. So OpenTrajectory v1 commits to three things that keep it differentiated and a16z-warning-proof (a standard + community, not connectors the labs build):

1. **A concrete portable artifact**, not just spans — one JSON file with ordered `steps`, each carrying `tool` (name/args/result/**success**), `decisions`, and a top-level `outcome`/`verdict`. Eval-first fields the Inspector already scores.
2. **An OTel-GenAI mapping appendix** — so OpenTrajectory is "OTel-compatible," not a competing telemetry SDK. (Future: emit OTel spans *and* an OpenTrajectory file from one capture.)
3. **Build on the shipped Inspector** as the reference reader/scorer — the validated judge already exists; the new layers are live capture + the format.

**Fallback value (if the standard is slow to adopt):** the RL Trajectory Auditor / Inspector gains **live cross-harness capture** — a real product upgrade regardless of standard adoption. So the downside is bounded.

**Scope guardrails reaffirmed:** v1 = Claude Code adapter only; capture + format + Inspector-reads-it + one wedge demo. No retraining loop (ever — their lane). No multi-harness adapters in v1 (Codex/Gemini/LangGraph are characterized above and slated for v2). No hosted registry UI in v1.
