// OpenAI Codex CLI rollout (JSONL) -> OpenTrajectory v0.1. Zero dependencies.
// Schema verified first-hand from ~/.codex/sessions/**/rollout-*.jsonl
// (see docs/harness-emit-analysis.md §1b). Each line is {timestamp, type, payload};
// the trajectory spine lives in type:"response_item" payloads:
//   message (role + content[{text}]), function_call (name/arguments/call_id),
//   function_call_output (call_id/output). Tool success is read from the
//   "Exit code: N" prefix Codex writes into the output.
import { OT_VERSION } from "./types.js";
import type { Step, ToolCall, Trajectory, OutcomeStatus } from "./types.js";
import { redact, truncate, asText } from "./redact.js";

type RawEvent = Record<string, any>;

/** Parse rollout JSONL into ordered events, skipping blank/garbage lines. */
export function parseRollout(jsonl: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Codex writes "Exit code: N\n…" at the head of shell output; 0 == success. */
function outputSuccess(output: string): boolean {
  const m = output.match(/^Exit code:\s*(-?\d+)/);
  if (m) return m[1] === "0";
  return !/\b(error|traceback|exception|failed)\b/i.test(output.slice(0, 200));
}

/**
 * Convert parsed Codex rollout events into one OpenTrajectory document.
 * Pairs function_call/function_call_output by call_id; skips encrypted
 * reasoning items; pulls the task from the first real user prompt.
 */
export function fromCodex(events: RawEvent[], opts: { trajectoryId?: string } = {}): Trajectory {
  // index tool outputs by call_id (they arrive as their own response_item)
  const outputById = new Map<string, string>();
  for (const ev of events) {
    const p = ev?.payload;
    if (ev?.type === "response_item" && p?.type === "function_call_output" && p.call_id) {
      outputById.set(p.call_id, typeof p.output === "string" ? p.output : asText(p.output));
    }
  }

  const steps: Step[] = [];
  const pushStep = (s: Omit<Step, "index">) => steps.push({ index: steps.length, ...s });

  let cliVersion: string | undefined;
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let cleanUserPrompt: string | undefined; // from event_msg user_message (no preamble)
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  for (const ev of events) {
    const p = ev?.payload;
    if (!p || typeof p !== "object") continue;
    if (ev.timestamp) {
      startedAt ??= ev.timestamp;
      endedAt = ev.timestamp;
    }

    if (ev.type === "session_meta") {
      cliVersion ??= p.cli_version;
      sessionId ??= p.id;
      cwd ??= p.cwd;
      continue;
    }
    if (ev.type === "event_msg" && p.type === "user_message" && typeof p.message === "string") {
      cleanUserPrompt ??= p.message;
      continue;
    }
    if (ev.type !== "response_item") continue;

    if (p.type === "message") {
      const text = asText(p.content);
      if (!text.trim()) continue;
      const r = redact(text);
      pushStep({
        role: p.role === "user" ? "user" : "assistant",
        ts: ev.timestamp,
        message: { text: truncate(r.text), redacted: r.redacted || undefined },
      });
    } else if (p.type === "function_call") {
      const out = p.call_id ? outputById.get(p.call_id) : undefined;
      const argsRed = redact(typeof p.arguments === "string" ? p.arguments : JSON.stringify(p.arguments ?? {}));
      let args: Record<string, unknown> = {};
      let argsText: string | undefined;
      try {
        args = JSON.parse(argsRed.text);
      } catch {
        argsText = argsRed.text;
      }
      const success = out != null ? outputSuccess(out) : true;
      const resultRed = out != null ? redact(out) : undefined;
      const tool_call: ToolCall = {
        id: p.call_id,
        name: String(p.name || "unknown"),
        args,
        args_text: argsText,
        result: resultRed ? truncate(resultRed.text) : undefined,
        success,
        redacted: argsRed.redacted || resultRed?.redacted || undefined,
      };
      if (!success && tool_call.result) tool_call.error = tool_call.result;
      pushStep({ role: "assistant", ts: ev.timestamp, tool_call });
    }
    // reasoning items are encrypted/empty -> skipped (no usable content)
  }

  // outcome: failure if the last tool errored; partial if any did; else success
  const toolSteps = steps.filter((s) => s.tool_call);
  let status: OutcomeStatus = "unknown";
  if (toolSteps.length > 0) {
    const last = toolSteps[toolSteps.length - 1].tool_call!;
    const anyErr = toolSteps.some((s) => s.tool_call!.success === false);
    status = last.success === false ? "failure" : anyErr ? "partial" : "success";
  }

  const firstUserStep = steps.find((s) => s.role === "user" && s.message);
  const description = (cleanUserPrompt || firstUserStep?.message?.text || "").slice(0, 500);

  return {
    ot_version: OT_VERSION,
    trajectory_id: opts.trajectoryId || sessionId || "codex-trajectory",
    harness: { name: "codex-cli", version: cliVersion },
    task: description ? { description } : undefined,
    started_at: startedAt,
    ended_at: endedAt,
    steps,
    outcome: { status },
    metadata: { session_id: sessionId, cwd },
  };
}

/** Convenience: rollout JSONL string -> Trajectory. */
export function captureFromRollout(jsonl: string, opts?: { trajectoryId?: string }): Trajectory {
  return fromCodex(parseRollout(jsonl), opts);
}

/** Heuristic: does this JSONL look like a Codex rollout (vs a Claude Code transcript)? */
export function looksLikeCodex(jsonl: string): boolean {
  for (const line of jsonl.split("\n").slice(0, 40)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (["session_meta", "response_item", "event_msg", "turn_context"].includes(o.type)) return true;
      if (o.type === "assistant" || o.type === "user") return false;
    } catch {
      /* skip */
    }
  }
  return false;
}
