// LangGraph / LangChain run tree (LangSmith export) -> OpenTrajectory v0.1. Zero deps.
//
// PROVISIONAL — not yet validated against a real captured export. Unlike the Claude
// Code / Codex / Gemini adapters (checked against real on-disk sessions), this is built
// from the DOCUMENTED LangSmith run-tree shape and exercised with synthetic fixtures.
// A LangSmith "Run" has: id, name, run_type (llm|chat_model|tool|chain|retriever|
// prompt|parser), inputs, outputs, error, start_time, parent_run_id, dotted_order, and
// either nested child_runs or a flat list. Tool runs carry the tool name/args/result;
// llm runs carry the text. We handle the three real export shapes:
//   1. a nested root with `child_runs`               (RunTree.to_dict / single trace)
//   2. a flat list ordered by `dotted_order`         (LangSmith canonical order field)
//   3. a flat list linked only by `parent_run_id`    (the list-runs API endpoint)
// reconstructing tree order in (2)/(3) rather than trusting wall-clock start_time.
// See docs/harness-emit-analysis.md §1d and the validation checklist there.
import { OT_VERSION } from "./types.js";
import type { Step, ToolCall, Trajectory, OutcomeStatus } from "./types.js";
import { redact, truncate, asText } from "./redact.js";

type Run = Record<string, any>;

/** Flatten the input into an ordered run list, supporting the real export shapes:
 *  a `{runs:[...]}` wrapper, a nested root with `child_runs`, a flat list ordered by
 *  `dotted_order`, or a flat list linked only by `parent_run_id`. Tree order is
 *  reconstructed (depth-first) rather than trusting wall-clock `start_time`. */
export function flattenRuns(input: unknown): Run[] {
  const root = (input && typeof input === "object" && !Array.isArray(input) && (input as any).runs) || input;
  if (Array.isArray(root)) {
    // (1) explicit nesting via child_runs — expand each top-level tree
    const hasNesting = root.some((r) => Array.isArray(r?.child_runs) && r.child_runs.length);
    if (hasNesting) return root.flatMap((r) => dfs(r));
    // (2) LangSmith canonical order: dotted_order encodes the full root->node path, so a
    //     plain lexicographic sort yields exact depth-first tree order.
    if (root.some((r) => typeof r?.dotted_order === "string")) return [...root].sort(byOrder);
    // (3) flat list linked only by parent_run_id (the list-runs API endpoint) — rebuild the tree
    if (root.some((r) => r?.parent_run_id)) return treeFromParentIds(root);
    // (4) last resort: order by start_time
    return [...root].sort(byOrder);
  }
  if (root && typeof root === "object") return dfs(root as Run);
  return [];
}

/** Order by dotted_order when present (canonical), else by start_time. */
function byOrder(a: Run, b: Run): number {
  return (
    String(a?.dotted_order || "").localeCompare(String(b?.dotted_order || "")) ||
    String(a?.start_time || "").localeCompare(String(b?.start_time || ""))
  );
}

/** Rebuild depth-first order from a flat list whose only nesting signal is parent_run_id. */
function treeFromParentIds(arr: Run[]): Run[] {
  const ids = new Set(arr.map((r) => r?.id));
  const childrenOf = new Map<string, Run[]>();
  const roots: Run[] = [];
  for (const r of arr) {
    const p = r?.parent_run_id;
    if (p && ids.has(p)) {
      const sibs = childrenOf.get(p) ?? [];
      sibs.push(r);
      childrenOf.set(p, sibs);
    } else {
      roots.push(r); // no parent, or parent outside this slice -> treat as a root
    }
  }
  const out: Run[] = [];
  const visit = (r: Run) => {
    out.push(r);
    for (const k of (childrenOf.get(r?.id) ?? []).sort(byOrder)) visit(k);
  };
  for (const r of roots.sort(byOrder)) visit(r);
  return out;
}

function dfs(run: Run, out: Run[] = []): Run[] {
  if (!run || typeof run !== "object") return out;
  out.push(run);
  const kids = Array.isArray(run.child_runs) ? [...run.child_runs].sort(byOrder) : [];
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
    // token usage lives in different places across LangChain versions:
    // legacy llm_output.token_usage, run extra.token_usage, or the newer usage_metadata.
    const usage = r.outputs?.llm_output?.token_usage || r.extra?.token_usage || r.outputs?.usage_metadata || r.usage_metadata;
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
