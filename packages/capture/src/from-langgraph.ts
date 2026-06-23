// LangGraph / LangChain run tree (LangSmith export) -> OpenTrajectory v0.1. Zero deps.
//
// NOT first-hand verified. Unlike the Claude Code / Codex / Gemini adapters (checked
// against real on-disk sessions), this is built from the DOCUMENTED LangSmith run-tree
// shape and exercised with synthetic fixtures. A LangSmith "Run" has: id, name,
// run_type (llm|chat_model|tool|chain|retriever|prompt|parser), inputs, outputs,
// error, start_time, parent_run_id, and either nested child_runs or a flat list keyed
// by parent_run_id. Tool runs carry the tool name/args/result; llm runs carry the text.
// See docs/harness-emit-analysis.md §1d.
import { OT_VERSION } from "./types.js";
import type { Step, ToolCall, Trajectory, OutcomeStatus } from "./types.js";
import { redact, truncate, asText } from "./redact.js";

type Run = Record<string, any>;

/** Flatten the input into an ordered run list, supporting the common export shapes:
 *  a flat array, a `{runs:[...]}` wrapper, or a nested root with `child_runs`. */
export function flattenRuns(input: unknown): Run[] {
  const root = (input && typeof input === "object" && !Array.isArray(input) && (input as any).runs) || input;
  if (Array.isArray(root)) {
    // flat list — if it has nesting via child_runs, expand; else order by start_time
    const hasNesting = root.some((r) => Array.isArray(r?.child_runs) && r.child_runs.length);
    if (hasNesting) return root.flatMap((r) => dfs(r));
    return [...root].sort(byStart);
  }
  if (root && typeof root === "object") return dfs(root as Run);
  return [];
}

function byStart(a: Run, b: Run): number {
  return String(a?.start_time || "").localeCompare(String(b?.start_time || ""));
}

function dfs(run: Run, out: Run[] = []): Run[] {
  if (!run || typeof run !== "object") return out;
  out.push(run);
  const kids = Array.isArray(run.child_runs) ? [...run.child_runs].sort(byStart) : [];
  for (const k of kids) dfs(k, out);
  return out;
}

function llmText(outputs: unknown): string {
  if (!outputs || typeof outputs !== "object") return asText(outputs);
  const o = outputs as any;
  // LangChain LLMResult: generations[][].text ; chat: .message.content
  const gens = o.generations;
  if (Array.isArray(gens)) {
    const texts: string[] = [];
    for (const row of gens.flat()) {
      if (row?.text) texts.push(String(row.text));
      else if (row?.message?.content) texts.push(asText(row.message.content));
    }
    if (texts.length) return texts.join("\n");
  }
  if (o.output) return asText(o.output);
  if (o.content) return asText(o.content);
  return "";
}

/** Convert a parsed LangGraph/LangSmith run tree into one OpenTrajectory document. */
export function fromLangGraph(input: unknown, opts: { trajectoryId?: string } = {}): Trajectory {
  const runs = flattenRuns(input);
  const steps: Step[] = [];
  const push = (s: Omit<Step, "index">) => steps.push({ index: steps.length, ...s });

  let traceId: string | undefined;
  let description: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let inTok = 0;
  let outTok = 0;
  let rootResolved: boolean | undefined;

  for (const r of runs) {
    traceId ??= r.trace_id || r.id;
    if (r.start_time) {
      startedAt ??= r.start_time;
    }
    if (r.end_time) endedAt = r.end_time;
    const usage = r.outputs?.llm_output?.token_usage || r.extra?.token_usage;
    if (usage) {
      inTok += Number(usage.prompt_tokens || usage.input_tokens || 0);
      outTok += Number(usage.completion_tokens || usage.output_tokens || 0);
    }

    const type = String(r.run_type || "");
    if (type === "tool") {
      const argsRed = redact(JSON.stringify(r.inputs ?? {}));
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(argsRed.text); } catch { args = {}; }
      const resText = asText(r.outputs?.output ?? r.outputs);
      const success = !r.error;
      const resultRed = redact(resText);
      const tool_call: ToolCall = {
        id: r.id,
        name: String(r.name || "tool"),
        args,
        result: resultRed.text ? truncate(resultRed.text) : undefined,
        success,
        redacted: argsRed.redacted || resultRed.redacted || undefined,
      };
      if (!success) tool_call.error = String(r.error).slice(0, 8000);
      push({ role: "assistant", ts: r.start_time, tool_call });
    } else if (type === "llm" || type === "chat_model") {
      const text = llmText(r.outputs);
      if (text.trim()) {
        const red = redact(text);
        push({ role: "assistant", ts: r.start_time, message: { text: truncate(red.text), redacted: red.redacted || undefined } });
      }
    } else if (type === "chain" && description === undefined) {
      // top-level chain holds the task input + final resolution
      description = asText(r.inputs?.input ?? r.inputs?.messages ?? r.inputs);
      if (r.error == null && r.outputs != null) rootResolved = true;
      else if (r.error != null) rootResolved = false;
    }
  }

  const toolSteps = steps.filter((s) => s.tool_call);
  let status: OutcomeStatus = "unknown";
  if (toolSteps.length > 0) {
    const last = toolSteps[toolSteps.length - 1].tool_call!;
    const anyErr = toolSteps.some((s) => s.tool_call!.success === false);
    status = last.success === false ? "failure" : anyErr ? "partial" : "success";
  } else if (rootResolved === true) status = "success";
  else if (rootResolved === false) status = "failure";

  return {
    ot_version: OT_VERSION,
    trajectory_id: opts.trajectoryId || traceId || "langgraph-trajectory",
    harness: { name: "langgraph" },
    task: description ? { description: String(description).slice(0, 500) } : undefined,
    started_at: startedAt,
    ended_at: endedAt,
    steps,
    outcome: { status, ...(rootResolved !== undefined ? { resolved: rootResolved } : {}) },
    cost: inTok || outTok ? { input_tokens: inTok, output_tokens: outTok } : undefined,
    metadata: { trace_id: traceId },
  };
}

export function captureFromLangGraph(json: string, opts?: { trajectoryId?: string }): Trajectory {
  return fromLangGraph(JSON.parse(json), opts);
}

/** Heuristic: does this look like a LangSmith run tree (runs carry `run_type`)? */
export function looksLikeLangGraph(text: string): boolean {
  try {
    const o = JSON.parse(text);
    const probe = Array.isArray(o) ? o[0] : o?.runs?.[0] ?? o;
    return !!probe && typeof probe === "object" && typeof probe.run_type === "string";
  } catch {
    return false;
  }
}
