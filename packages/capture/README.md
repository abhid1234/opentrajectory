# @opentrajectory/capture

**Capture an AI agent run into one open, vendor-neutral `.ot.json` — then validate, diagnose, and judge it.** Zero runtime dependencies (Node built-ins only).

Part of [OpenTrajectory](https://github.com/abhid1234/opentrajectory): the open format every agent can emit, and the reference tools that read it.

```bash
npm i -D @opentrajectory/capture
```

## CLI (`ot`)

```
ot capture <file> [-o out] [--harness claude-code|codex|gemini]   capture a run (auto-detected)
ot validate <file.ot.json|.ot.jsonl>                              conformance check (spec §7)
ot diagnose <file.ot.json>                                        offline heuristic diagnosis (no key)
ot judge <file.ot.json> [--dry-run]                               fill outcome.verdict via Gemini
ot to-messages <file.ot.json>                                     OpenAI-style messages
ot to-otel <file.ot.json>                                         OpenTelemetry GenAI spans (OTLP/JSON)
ot hook                                                           live PostToolUse hook (reads stdin)
```

```bash
# capture a real Claude Code session, then see why it failed — no API key
npx ot capture ~/.claude/projects/<slug>/<session>.jsonl -o run.ot.json
npx ot diagnose run.ot.json
```

Capture adapters are verified first-hand against real on-disk sessions for **Claude Code**, **Codex CLI**, and **Gemini CLI**; `ot capture` auto-detects which.

## SDK

```ts
import {
  captureFromTranscript,   // Claude Code transcript -> Trajectory
  captureFromRollout,      // Codex rollout -> Trajectory
  captureFromGeminiSession,// Gemini session -> Trajectory
  validate,                // conformance (spec §7)
  diagnoseHeuristic,       // offline diagnosis (no key)
  judgeTrajectory,         // LLM judge -> verdict (Gemini)
  toMessages, toOtel,      // interop: OpenAI messages / OTel spans
} from "@opentrajectory/capture";

const traj = captureFromTranscript(transcriptJsonl);
if (validate(traj).valid) console.log(diagnoseHeuristic(traj).diagnosis); // HARNESS | TRAINING | PRODUCT | CLEAN
```

All capture/validate/diagnose/convert runs are **zero-dependency and offline**. `judgeTrajectory` is the one paid path — it calls Gemini (`GEMINI_API_KEY`), and the trajectory is redacted of secrets at capture time.

## Format

A trajectory is one self-contained JSON file: ordered `steps` (each a `message`, a `tool_call` with `name`/`args`/`result`/`success`, or a `decision`), a top-level `outcome` (`status` + optional evaluator `verdict`), and `harness`/`task`/`cost`/`metadata`. Full spec + JSON Schema: https://github.com/abhid1234/opentrajectory

## License

MIT (code) · CC0 (the format spec). See [LICENSE](./LICENSE).
