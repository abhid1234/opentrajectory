// Antigravity CLI session (JSON) -> OpenTrajectory v0.1. Zero dependencies.
// Schema verified first-hand from ~/.gemini/tmp/<hash>/chats/session-*.json
// (see docs/harness-emit-analysis.md §1c). Unlike Claude Code / Codex (JSONL),
// a Gemini session is a single JSON object: { sessionId, startTime, messages[] }.
// messages[].type is user | gemini | info; a `gemini` message may carry
// toolCalls[] = { id, name, args, result } and a tokens object.
import { OT_VERSION } from "./types.js";
import type { Step, ToolCall, Trajectory, OutcomeStatus } from "./types.js";
import { redact, truncate, asText } from "./redact.js";

type RawMsg = Record<string, any>;

/** Gemini tool result lives at result[].functionResponse.response.{output|error}. */
function geminiToolResult(result: unknown): { text: string; success: boolean } {
  if (!Array.isArray(result)) return { text: asText(result), success: true };
  const parts: string[] = [];
  let success = true;
  for (const r of result) {
    const resp = r?.functionResponse?.response;
    if (resp && typeof resp === "object") {
      if (resp.error != null) {
        success = false;
        parts.push(typeof resp.error === "string" ? resp.error : JSON.stringify(resp.error));
      } else if (resp.output != null) {
        parts.push(typeof resp.output === "string" ? resp.output : JSON.stringify(resp.output));
      } else {
        parts.push(JSON.stringify(resp));
      }
    } else {
      parts.push(typeof r === "string" ? r : JSON.stringify(r));
    }
  }
  return { text: parts.join("\n"), success };
}

/** Convert a parsed Antigravity CLI session object into one OpenTrajectory document. */
export function fromGemini(session: Record<string, any>, opts: { trajectoryId?: string } = {}): Trajectory {
  const messages: RawMsg[] = Array.isArray(session?.messages) ? session.messages : [];
  const steps: Step[] = [];
  const pushStep = (s: Omit<Step, "index">) => steps.push({ index: steps.length, ...s });
  let inputTokens = 0;
  let outputTokens = 0;
  let firstUser: string | undefined;

  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.type === "info") continue; // UI/system notices — not part of the trajectory
    const tok = m.tokens;
    if (tok) {
      inputTokens += Number(tok.input || 0);
      outputTokens += Number(tok.output || 0);
    }

    if (m.type === "user") {
      const text = asText(m.content);
      if (!text.trim()) continue;
      firstUser ??= text;
      const r = redact(text);
      pushStep({ role: "user", ts: m.timestamp, message: { text: truncate(r.text), redacted: r.redacted || undefined } });
      continue;
    }

    // type === "gemini" (assistant): optional text + optional toolCalls
    const text = asText(m.content);
    if (text.trim()) {
      const r = redact(text);
      pushStep({ role: "assistant", ts: m.timestamp, message: { text: truncate(r.text), redacted: r.redacted || undefined } });
    }
    const tcs = Array.isArray(m.toolCalls) ? m.toolCalls : [];
    for (const tc of tcs) {
      const { text: resText, success } = geminiToolResult(tc.result);
      const argsRed = redact(JSON.stringify(tc.args ?? {}));
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsRed.text);
      } catch {
        args = {};
      }
      const resultRed = redact(resText);
      const tool_call: ToolCall = {
        id: tc.id,
        name: String(tc.name || "unknown"),
        args,
        result: resultRed.text ? truncate(resultRed.text) : undefined,
        success,
        redacted: argsRed.redacted || resultRed.redacted || undefined,
      };
      if (!success && tool_call.result) tool_call.error = tool_call.result;
      pushStep({ role: "assistant", ts: m.timestamp, tool_call });
    }
  }

  const toolSteps = steps.filter((s) => s.tool_call);
  let status: OutcomeStatus = "unknown";
  if (toolSteps.length > 0) {
    const last = toolSteps[toolSteps.length - 1].tool_call!;
    const anyErr = toolSteps.some((s) => s.tool_call!.success === false);
    status = last.success === false ? "failure" : anyErr ? "partial" : "success";
  }

  return {
    ot_version: OT_VERSION,
    trajectory_id: opts.trajectoryId || session?.sessionId || "gemini-trajectory",
    harness: { name: "antigravity" },
    task: firstUser ? { description: firstUser.slice(0, 500) } : undefined,
    model: undefined,
    started_at: session?.startTime,
    ended_at: session?.lastUpdated,
    steps,
    outcome: { status },
    cost: { input_tokens: inputTokens, output_tokens: outputTokens },
    metadata: { session_id: session?.sessionId },
  };
}

/** Convenience: session JSON string -> Trajectory. */
export function captureFromGeminiSession(json: string, opts?: { trajectoryId?: string }): Trajectory {
  return fromGemini(JSON.parse(json), opts);
}

/** Heuristic: does this text look like a Antigravity CLI session (single JSON object)? */
export function looksLikeGemini(text: string): boolean {
  const t = text.trimStart();
  if (!t.startsWith("{")) return false;
  try {
    const o = JSON.parse(text);
    return !!o && typeof o === "object" && !Array.isArray(o) && typeof o.sessionId === "string" && Array.isArray(o.messages);
  } catch {
    return false;
  }
}
