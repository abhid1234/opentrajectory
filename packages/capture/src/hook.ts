// Live capture: a Claude Code PostToolUse hook handler. Zero dependencies.
// Wire in ~/.claude/settings.json:
//   "PostToolUse": [{ "matcher": "*", "hooks": [
//     { "type": "command", "command": "node /path/opentrajectory/packages/capture/dist/cli.js hook" } ]}]
//
// On each tool result Claude Code pipes a JSON payload to stdin with:
//   { session_id, transcript_path, cwd, hook_event_name, tool_name, tool_input, tool_response }
// (see docs/harness-emit-analysis.md §1a-B). We append one OpenTrajectory step
// to a per-session sidecar at <transcript_dir>/<session>.ot.jsonl. The hook never
// blocks the agent: it always exits 0 and swallows its own errors.
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Step, ToolCall } from "./types.js";

export interface PostToolUsePayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
}

function responseText(r: unknown): { text: string; success: boolean } {
  if (r == null) return { text: "", success: true };
  if (typeof r === "string") return { text: r, success: !/error/i.test(r.slice(0, 40)) };
  if (typeof r === "object") {
    const o = r as Record<string, unknown>;
    const success = o.is_error === true ? false : o.success === false ? false : true;
    const text =
      typeof o.content === "string"
        ? o.content
        : typeof o.stdout === "string"
          ? o.stdout
          : JSON.stringify(o);
    return { text, success };
  }
  return { text: String(r), success: true };
}

/** Build a single OpenTrajectory step (index filled by the appender) from a hook payload. */
export function stepFromPayload(p: PostToolUsePayload): Omit<Step, "index"> {
  const { text, success } = responseText(p.tool_response);
  const tool_call: ToolCall = {
    name: String(p.tool_name || "unknown"),
    args: (p.tool_input as Record<string, unknown>) || {},
    result: text.length > 8000 ? text.slice(0, 8000) + "\n…[truncated]" : text,
    success,
  };
  if (!success) tool_call.error = tool_call.result;
  return { role: "assistant", ts: new Date().toISOString(), tool_call };
}

/** Sidecar path for a session's live trajectory steps. */
export function sidecarPath(p: PostToolUsePayload): string {
  const dir = p.transcript_path ? dirname(p.transcript_path) : p.cwd || ".";
  const id = p.session_id || "session";
  return join(dir, `${id}.ot.jsonl`);
}

/** Append one step (as a JSONL line) to the session sidecar. Never throws. */
export function appendStep(p: PostToolUsePayload): void {
  try {
    appendFileSync(sidecarPath(p), JSON.stringify(stepFromPayload(p)) + "\n");
  } catch {
    /* live capture must never break the agent */
  }
}

/** Read the whole hook payload from a stdin stream, then append a step. */
export function runHook(stdin: NodeJS.ReadStream): void {
  let buf = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (c) => (buf += c));
  stdin.on("end", () => {
    try {
      appendStep(JSON.parse(buf || "{}"));
    } catch {
      /* swallow */
    }
    process.exit(0);
  });
}
