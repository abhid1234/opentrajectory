// Claude Code transcript (JSONL) -> OpenTrajectory v0.1. Zero dependencies.
// Schema verified first-hand from ~/.claude/projects/<slug>/<session>.jsonl
// (see docs/harness-emit-analysis.md §1a).
import { OT_VERSION } from "./types.js";
import type { Step, ToolCall, Trajectory, OutcomeStatus } from "./types.js";

const MAX_RESULT_CHARS = 8000;

// Secrets to redact from args/results before they leave the machine.
const SECRET_RE =
  /(sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_\-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g;

function redact(s: string): { text: string; redacted: boolean } {
  let redacted = false;
  const text = s.replace(SECRET_RE, () => {
    redacted = true;
    return "[REDACTED]";
  });
  return { text, redacted };
}

function truncate(s: string): string {
  return s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + "\n…[truncated]" : s;
}

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text ?? "") : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

type RawEvent = Record<string, any>;

/** Parse JSONL text into ordered events, skipping blank/garbage lines. */
export function parseTranscript(jsonl: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip non-JSON lines */
    }
  }
  return out;
}

/**
 * Convert a parsed Claude Code transcript into one OpenTrajectory document.
 * Maps tool_use blocks -> steps, pairs tool_result by tool_use_id for success/result,
 * carries through model/usage/cost, and infers outcome.status.
 */
export function fromClaudeCode(events: RawEvent[], opts: { trajectoryId?: string } = {}): Trajectory {
  // First pass: index tool_result blocks by tool_use_id (they arrive in later `user` events).
  const resultById = new Map<string, { text: string; is_error: boolean }>();
  for (const ev of events) {
    const content = ev?.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b && b.type === "tool_result" && b.tool_use_id) {
          resultById.set(b.tool_use_id, {
            text: asText(b.content),
            is_error: b.is_error === true,
          });
        }
      }
    }
  }

  const steps: Step[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | undefined;
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;

  const pushStep = (s: Omit<Step, "index">) => {
    steps.push({ index: steps.length, ...s });
  };

  for (const ev of events) {
    const type = ev?.type;
    if (type !== "assistant" && type !== "user") continue;
    const msg = ev?.message;
    if (!msg) continue;

    sessionId ??= ev.sessionId;
    cwd ??= ev.cwd;
    gitBranch ??= ev.gitBranch;
    if (ev.timestamp) {
      firstTs ??= ev.timestamp;
      lastTs = ev.timestamp;
    }
    if (msg.model && msg.model !== "<synthetic>") model = msg.model;
    if (msg.usage) {
      inputTokens += Number(msg.usage.input_tokens || 0);
      outputTokens += Number(msg.usage.output_tokens || 0);
    }

    const isSub = ev.isSidechain === true;
    const content = msg.content;

    // Plain string content -> a message step.
    if (typeof content === "string") {
      if (content.trim()) {
        const r = redact(content);
        pushStep({
          role: type === "user" ? "user" : "assistant",
          ts: ev.timestamp,
          is_subagent: isSub || undefined,
          message: { text: truncate(r.text), redacted: r.redacted || undefined },
        });
      }
      continue;
    }
    if (!Array.isArray(content)) continue;

    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        const r = redact(b.text);
        pushStep({
          role: type === "user" ? "user" : "assistant",
          ts: ev.timestamp,
          is_subagent: isSub || undefined,
          message: { text: truncate(r.text), redacted: r.redacted || undefined },
        });
      } else if (b.type === "tool_use") {
        const res = b.id ? resultById.get(b.id) : undefined;
        const argsRed = redact(JSON.stringify(b.input ?? {}));
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(argsRed.text);
        } catch {
          args = {};
        }
        const resultRed = res ? redact(res.text) : undefined;
        const tool_call: ToolCall = {
          id: b.id,
          name: String(b.name || "unknown"),
          args,
          result: resultRed ? truncate(resultRed.text) : undefined,
          success: res ? !res.is_error : true,
          redacted: argsRed.redacted || resultRed?.redacted || undefined,
        };
        if (res?.is_error) tool_call.error = tool_call.result;
        pushStep({
          role: "assistant",
          ts: ev.timestamp,
          is_subagent: isSub || undefined,
          tool_call,
        });
      }
      // tool_result blocks are folded into their tool_call above; skip here.
    }
  }

  // Infer outcome: failure if the last tool call errored; success otherwise.
  const toolSteps = steps.filter((s) => s.tool_call);
  const lastTool = toolSteps[toolSteps.length - 1];
  const anyError = toolSteps.some((s) => s.tool_call!.success === false);
  let status: OutcomeStatus = "unknown";
  if (toolSteps.length > 0) {
    if (lastTool!.tool_call!.success === false) status = "failure";
    else status = anyError ? "partial" : "success";
  }

  const firstUser = steps.find((s) => s.role === "user" && s.message);

  return {
    ot_version: OT_VERSION,
    trajectory_id: opts.trajectoryId || sessionId || "claude-code-trajectory",
    harness: { name: "claude-code" },
    task: firstUser?.message ? { description: firstUser.message.text.slice(0, 500) } : undefined,
    model,
    started_at: firstTs,
    ended_at: lastTs,
    steps,
    outcome: { status },
    cost: { input_tokens: inputTokens, output_tokens: outputTokens },
    metadata: { session_id: sessionId, cwd, git_branch: gitBranch },
  };
}

/** Convenience: JSONL string -> Trajectory. */
export function captureFromTranscript(jsonl: string, opts?: { trajectoryId?: string }): Trajectory {
  return fromClaudeCode(parseTranscript(jsonl), opts);
}
