// OpenTrajectory -> OpenTelemetry GenAI spans (OTLP/JSON). Zero dependencies.
// Proves the spec's Appendix A positioning: OpenTrajectory is OTel-mappable —
// complementary to observability, not competing with it. The output is OTLP/JSON
// (the JSON encoding of an OTLP trace export), ingestible by any OTel collector,
// so a captured .ot.json can flow straight into Honeycomb / Grafana / Jaeger.
//
// Mapping (docs/opentrajectory-spec.md §Appendix A):
//   trajectory                  -> one trace, one root span (the agent run)
//   step with tool_call          -> child span, gen_ai.operation.name=execute_tool
//   tool_call.name               -> gen_ai.tool.name ; tool_call.id -> gen_ai.tool.call.id
//   outcome.status=failure       -> span status ERROR
//   cost.*_tokens                -> gen_ai.usage.input_tokens / output_tokens
//   verdict (eval-first)         -> opentrajectory.verdict.* (no OTel equivalent — the wedge)
import type { Trajectory, Step } from "./types.js";

// deterministic IDs (FNV-1a) so the same trajectory yields the same trace/span ids
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function traceId(t: Trajectory): string {
  return (fnv1a(t.trajectory_id) + fnv1a("trace:" + t.trajectory_id) + fnv1a(t.harness?.name || "") + fnv1a("ot")).slice(0, 32).padEnd(32, "0");
}
function spanId(t: Trajectory, key: string): string {
  return (fnv1a(t.trajectory_id + ":" + key) + fnv1a("span:" + key)).slice(0, 16).padEnd(16, "0");
}

function toNanos(ts: string | undefined, fallback: number): string {
  if (ts) {
    const ms = Date.parse(ts);
    if (!Number.isNaN(ms)) return String(ms * 1_000_000);
  }
  return String(fallback);
}

type Attr = { key: string; value: Record<string, unknown> };
const sAttr = (k: string, v: string): Attr => ({ key: k, value: { stringValue: v } });
const iAttr = (k: string, v: number): Attr => ({ key: k, value: { intValue: String(v) } });
const bAttr = (k: string, v: boolean): Attr => ({ key: k, value: { boolValue: v } });

const OTEL_STATUS = { UNSET: 0, OK: 1, ERROR: 2 } as const;

function stepSpan(t: Trajectory, s: Step, traceHex: string, rootSpanHex: string, base: number): Record<string, unknown> | null {
  if (!s.tool_call) return null;
  const tc = s.tool_call;
  const start = toNanos(s.ts, base + s.index * 1_000_000);
  const attrs: Attr[] = [
    sAttr("gen_ai.operation.name", "execute_tool"),
    sAttr("gen_ai.tool.name", tc.name),
    bAttr("opentrajectory.tool.success", tc.success),
    iAttr("opentrajectory.step.index", s.index),
  ];
  if (tc.id) attrs.push(sAttr("gen_ai.tool.call.id", tc.id));
  if (t.harness?.name) attrs.push(sAttr("gen_ai.system", t.harness.name));
  return {
    traceId: traceHex,
    spanId: spanId(t, "step" + s.index),
    parentSpanId: rootSpanHex,
    name: `execute_tool ${tc.name}`,
    kind: 3, // SPAN_KIND_CLIENT
    startTimeUnixNano: start,
    endTimeUnixNano: toNanos(undefined, Number(start) + (tc.duration_ms ?? 0) * 1_000_000 || Number(start)),
    attributes: attrs,
    status: { code: tc.success ? OTEL_STATUS.OK : OTEL_STATUS.ERROR, ...(tc.success ? {} : { message: (tc.error || "tool failed").slice(0, 200) }) },
  };
}

/** Convert one OpenTrajectory document into an OTLP/JSON trace export object. */
export function toOtel(t: Trajectory): Record<string, unknown> {
  const traceHex = traceId(t);
  const rootSpanHex = spanId(t, "root");
  const base = Date.parse(t.started_at || "") * 1_000_000 || 0;

  const rootAttrs: Attr[] = [
    sAttr("gen_ai.operation.name", "invoke_agent"),
    sAttr("opentrajectory.harness", t.harness?.name || "unknown"),
    sAttr("opentrajectory.outcome.status", t.outcome?.status || "unknown"),
    iAttr("opentrajectory.steps", t.steps.length),
  ];
  if (t.model) rootAttrs.push(sAttr("gen_ai.request.model", t.model));
  if (t.harness?.name) rootAttrs.push(sAttr("gen_ai.system", t.harness.name));
  if (typeof t.outcome?.resolved === "boolean") rootAttrs.push(bAttr("opentrajectory.outcome.resolved", t.outcome.resolved));
  if (t.cost?.input_tokens != null) rootAttrs.push(iAttr("gen_ai.usage.input_tokens", t.cost.input_tokens));
  if (t.cost?.output_tokens != null) rootAttrs.push(iAttr("gen_ai.usage.output_tokens", t.cost.output_tokens));
  // verdict has NO OTel equivalent — the eval-first wedge, carried as a vendor attribute
  const v = t.outcome?.verdict;
  if (v) {
    if (v.diagnosis) rootAttrs.push(sAttr("opentrajectory.verdict.diagnosis", String(v.diagnosis)));
    if (v.category) rootAttrs.push(sAttr("opentrajectory.verdict.category", v.category));
    if (v.confidence != null) rootAttrs.push(sAttr("opentrajectory.verdict.confidence", String(v.confidence)));
  }

  const rootStart = toNanos(t.started_at, base);
  const rootEnd = toNanos(t.ended_at, base + Math.max(1, t.steps.length) * 1_000_000);
  const rootSpan = {
    traceId: traceHex,
    spanId: rootSpanHex,
    name: `invoke_agent ${t.harness?.name || ""}`.trim(),
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: rootStart,
    endTimeUnixNano: rootEnd,
    attributes: rootAttrs,
    status: { code: t.outcome?.status === "failure" ? OTEL_STATUS.ERROR : OTEL_STATUS.OK },
  };

  const spans = [rootSpan, ...t.steps.map((s) => stepSpan(t, s, traceHex, rootSpanHex, base)).filter(Boolean)];

  return {
    resourceSpans: [
      {
        resource: { attributes: [sAttr("service.name", "opentrajectory"), sAttr("opentrajectory.trajectory_id", t.trajectory_id)] },
        scopeSpans: [{ scope: { name: "opentrajectory/capture", version: "0.1.0" }, spans }],
      },
    ],
  };
}
