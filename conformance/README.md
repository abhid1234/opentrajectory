# Conformance corpus — validate your adapter

A standard is only real if a *third party* can prove they emit it without the maintainers in
the loop. This directory is that proof harness: **nine canonical OpenTrajectory documents**, one
per shape an adapter has to get right, each a valid v0.1 document (spec [§7](../docs/opentrajectory-spec.md#7-conformance)).

If you are writing an adapter for a new harness, the goal is simple: **make your emitter produce
these shapes, and make `ot validate` pass on your output.** When it does, you conform.

## The cases

| File | Demonstrates |
|---|---|
| [`01-minimal.ot.json`](01-minimal.ot.json) | The floor — only the five required fields, zero steps. The smallest conformant document. |
| [`02-redaction.ot.json`](02-redaction.ot.json) | Secret redaction by construction: value replaced with `[REDACTED]`, nearest `redacted: true` set (§4). |
| [`03-failure.ot.json`](03-failure.ot.json) | A failed run: `tool_call.success: false` + `error`, a `give_up` decision, `outcome.status: failure`. |
| [`04-multi-tool.ot.json`](04-multi-tool.ot.json) | A real multi-step run: a `plan` decision then Grep → Edit → Bash, monotonic 0-based `index`, timing + cost. |
| [`05-verdict.ot.json`](05-verdict.ot.json) | An evaluator-filled `outcome.verdict` — the eval-first field telemetry formats lack. |
| [`harness-claude-code.ot.json`](harness-claude-code.ot.json) | Claude Code native shape normalized (`tool_use`/`tool_result`, `toolu_*` ids). |
| [`harness-codex-cli.ot.json`](harness-codex-cli.ot.json) | Codex CLI native shape normalized (`function_call`/`function_call_output`, `call_id`). |
| [`harness-gemini-cli.ot.json`](harness-gemini-cli.ot.json) | Gemini CLI native shape normalized (typed log items, `run_shell_command`, token usage). |
| [`harness-langgraph.ot.json`](harness-langgraph.ot.json) | LangGraph/LangSmith run tree normalized (nested runs by `run_type`). **Provisional** — documented schema, not a validated real export. |

## Validate against it

```bash
# your adapter's output, checked by the same validator the CLI + GitHub Action use:
node tools/ot-validate.mjs path/to/your-output.ot.json     # zero-dep, no build

# or run the whole corpus (what this repo's CI does):
node tools/ot-validate.mjs conformance/                    # 9/9 conformant
```

## Why these stay honest

[`manifest.json`](manifest.json) pairs every case with machine-checked invariants (`must`), and
[`check.mjs`](check.mjs) enforces them — so a case can never silently stop demonstrating what it
claims (e.g. the redaction case *must* contain `[REDACTED]` + a `redacted` flag; the failure case
*must* carry a failed tool and `status: failure`). It also fails if a `.ot.json` is added here
without a manifest entry.

```bash
node conformance/check.mjs        # validates all 9 + asserts each invariant; no orphans
```

This corpus is the seed of the future trajectory **registry** (Phase 4): the shared, versioned set
of shapes every adapter — first-party or community — is measured against.
