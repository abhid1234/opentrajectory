// Zero-dependency test runner for @opentrajectory/capture.
// Run: node --import tsx test/run.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate } from "../src/validate.js";
import { captureFromTranscript, fromClaudeCode } from "../src/from-claude-code.js";
import { captureFromRollout, looksLikeCodex } from "../src/from-codex.js";
import { toMessages } from "../src/to-messages.js";
import { stepFromPayload } from "../src/hook.js";
import { buildJudgePrompt, parseVerdict, judgeTrajectory, judgeAndFill } from "../src/judge.js";
import { diagnoseHeuristic } from "../src/heuristic.js";
import { toOtel } from "../src/to-otel.js";
import type { Trajectory } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

// --- 1. validator accepts the hand-authored example -------------------------
console.log("validator");
const example = JSON.parse(readFileSync(join(here, "../../../examples/hello.ot.json"), "utf8"));
ok("hello.ot.json is conformant", validate(example).valid, JSON.stringify(validate(example).errors));

// --- 2. validator rejects malformed docs ------------------------------------
ok("rejects non-object", !validate(42).valid);
ok("rejects missing trajectory_id", !validate({ ot_version: "0.1", harness: { name: "x" }, steps: [], outcome: { status: "success" } }).valid);
ok(
  "rejects out-of-order step index",
  !validate({
    ot_version: "0.1",
    trajectory_id: "t",
    harness: { name: "x" },
    steps: [{ index: 5, role: "user" }],
    outcome: { status: "success" },
  }).valid,
);
ok(
  "rejects tool_call missing success",
  !validate({
    ot_version: "0.1",
    trajectory_id: "t",
    harness: { name: "x" },
    steps: [{ index: 0, role: "assistant", tool_call: { name: "Bash", args: {} } }],
    outcome: { status: "success" },
  }).valid,
);
ok(
  "rejects bad outcome.status",
  !validate({ ot_version: "0.1", trajectory_id: "t", harness: { name: "x" }, steps: [], outcome: { status: "nope" } }).valid,
);

// --- 3. Claude Code parser on a synthetic-but-real-shaped transcript --------
console.log("from-claude-code");
const transcript = [
  JSON.stringify({ type: "user", sessionId: "s1", cwd: "/repo", gitBranch: "main", timestamp: "2026-06-22T00:00:00Z", message: { role: "user", content: "Fix the bug." } }),
  JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    timestamp: "2026-06-22T00:00:01Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      usage: { input_tokens: 100, output_tokens: 20 },
      content: [
        { type: "text", text: "I'll run the tests." },
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pytest" } },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    sessionId: "s1",
    timestamp: "2026-06-22T00:00:02Z",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "1 failed", is_error: true }] },
  }),
].join("\n");

const traj = captureFromTranscript(transcript);
ok("parser output is conformant", validate(traj).valid, JSON.stringify(validate(traj).errors));
ok("harness is claude-code", traj.harness.name === "claude-code");
ok("captured the tool call", traj.steps.some((s) => s.tool_call?.name === "Bash"));
ok("paired tool_result -> success=false", traj.steps.find((s) => s.tool_call?.name === "Bash")?.tool_call?.success === false);
ok("error tool result -> outcome failure", traj.outcome.status === "failure");
ok("rolled up cost tokens", traj.cost?.input_tokens === 100 && traj.cost?.output_tokens === 20);
ok("model carried through", traj.model === "claude-opus-4-8");
ok("first user msg -> task.description", (traj.task?.description || "").includes("Fix the bug"));

// --- 4. redaction ------------------------------------------------------------
const secretTranscript = JSON.stringify({
  type: "assistant",
  sessionId: "s2",
  message: { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789" } }] },
});
const redTraj = fromClaudeCode([JSON.parse(secretTranscript)]);
const redStep = redTraj.steps.find((s) => s.tool_call);
ok("redacts gh token in args", JSON.stringify(redStep?.tool_call?.args).includes("[REDACTED]"));
ok("marks step redacted", redStep?.tool_call?.redacted === true);

// --- 5. to-messages round trip ----------------------------------------------
console.log("to-messages");
const rec = toMessages(traj);
ok("messages produced", rec.messages.length > 0);
ok("assistant tool_call mapped", rec.messages.some((m) => m.tool_calls?.[0]?.function.name === "Bash"));
ok("tool result becomes tool message", rec.messages.some((m) => m.role === "tool" && m.content.includes("1 failed")));
ok("resolved=false for failure", rec.resolved === false);

// --- 6. hook step builder ----------------------------------------------------
console.log("hook");
const hookStep = stepFromPayload({ tool_name: "Read", tool_input: { file_path: "x.ts" }, tool_response: { content: "ok", is_error: false } });
ok("hook builds a tool_call step", hookStep.tool_call?.name === "Read");
ok("hook infers success", hookStep.tool_call?.success === true);
const hookFail = stepFromPayload({ tool_name: "Bash", tool_input: {}, tool_response: { content: "boom", is_error: true } });
ok("hook infers failure", hookFail.tool_call?.success === false);

// --- 6b. Codex rollout adapter ----------------------------------------------
console.log("from-codex");
const rollout = [
  JSON.stringify({ timestamp: "2026-06-22T00:00:00Z", type: "session_meta", payload: { id: "cx1", cwd: "/repo", cli_version: "0.80.0" } }),
  JSON.stringify({ timestamp: "2026-06-22T00:00:01Z", type: "event_msg", payload: { type: "user_message", message: "Fix the failing build.", images: [] } }),
  JSON.stringify({ timestamp: "2026-06-22T00:00:02Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "I'll run the build." }] } }),
  JSON.stringify({ timestamp: "2026-06-22T00:00:03Z", type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: '{"command":"make"}', call_id: "call_1" } }),
  JSON.stringify({ timestamp: "2026-06-22T00:00:04Z", type: "response_item", payload: { type: "function_call_output", call_id: "call_1", output: "Exit code: 2\nOutput:\nmake: *** No rule to make target. Stop." } }),
  JSON.stringify({ timestamp: "2026-06-22T00:00:05Z", type: "response_item", payload: { type: "reasoning", summary: [], content: null, encrypted_content: "gAAAA…" } }),
].join("\n");

const cx = captureFromRollout(rollout);
ok("codex output is conformant", validate(cx).valid, JSON.stringify(validate(cx).errors));
ok("harness is codex-cli", cx.harness.name === "codex-cli");
ok("carried cli_version", cx.harness.version === "0.80.0");
ok("captured the shell_command call", cx.steps.some((s) => s.tool_call?.name === "shell_command"));
ok("parsed structured args", cx.steps.find((s) => s.tool_call)?.tool_call?.args.command === "make");
ok("Exit code: 2 -> success=false", cx.steps.find((s) => s.tool_call)?.tool_call?.success === false);
ok("non-zero exit -> outcome failure", cx.outcome.status === "failure");
ok("task from clean user_message", (cx.task?.description || "").includes("Fix the failing build"));
ok("skipped encrypted reasoning item", !cx.steps.some((s) => JSON.stringify(s).includes("encrypted")));
ok("detects codex rollout", looksLikeCodex(rollout) === true);
ok("does not misdetect claude transcript", looksLikeCodex(transcript) === false);

// cross-harness invariant: both adapters emit the SAME shape the Inspector reads
const cxMsgs = toMessages(cx);
ok("codex -> messages round-trips", cxMsgs.messages.some((m) => m.tool_calls?.[0]?.function.name === "shell_command"));

// --- 6c. heuristic diagnoser (offline, no key) ------------------------------
console.log("heuristic");
const hCtx = diagnoseHeuristic({ ot_version: "0.1", trajectory_id: "h1", harness: { name: "x" },
  steps: [{ index: 0, role: "assistant", tool_call: { name: "Bash", args: { command: "pytest" }, result: "ModuleNotFoundError: No module named 'jwt'", success: false } }],
  outcome: { status: "failure", resolved: false } } as Trajectory);
ok("heuristic flags HARNESS on context gap", hCtx.diagnosis === "HARNESS");
ok("heuristic cites evidence", hCtx.evidence.length > 0);

const hClean = diagnoseHeuristic({ ot_version: "0.1", trajectory_id: "h2", harness: { name: "x" },
  steps: [{ index: 0, role: "assistant", tool_call: { name: "Bash", args: { command: "npm test" }, result: "All passed", success: true } }],
  outcome: { status: "success", resolved: true } } as Trajectory);
ok("heuristic returns CLEAN on resolved success", hClean.diagnosis === "CLEAN");

const hHack = diagnoseHeuristic({ ot_version: "0.1", trajectory_id: "h3", harness: { name: "x" },
  steps: [{ index: 0, role: "assistant", tool_call: { name: "Edit", args: { file_path: "tests/test_x.py", old_string: "==5", new_string: "==4" }, result: "ok", success: true } }],
  outcome: { status: "success", resolved: true } } as Trajectory);
ok("heuristic flags TRAINING on test-file edit", hHack.diagnosis === "TRAINING");

// --- 7. judge: prompt, parse, full run via injected transport ---------------
console.log("judge");
ok("prompt embeds the 4-point taxonomy", buildJudgePrompt(traj).includes("HARNESS (broken environment)"));
ok("prompt renders a tool step with success flag", /tool:Bash.*\[ERR\]/.test(buildJudgePrompt(traj)));
ok("prompt includes the task", buildJudgePrompt(traj).includes("Fix the bug"));

const v1 = parseVerdict({ diagnosis: "harness", failure_category: "Context Gap", confidence: 0.9, reasoning: "missing dep", offending_step_index: 2 });
ok("parse normalizes diagnosis to upper", v1.diagnosis === "HARNESS");
ok("parse keeps human category", v1.category === "Context Gap");
ok("parse coerces offending index to int", v1.offending_step_index === 2);
ok("parse stamps evaluator", (v1.evaluator || "").startsWith("opentrajectory/judge"));
ok("parse defaults bad diagnosis to CLEAN", parseVerdict({ diagnosis: "nonsense", confidence: "x" }).diagnosis === "CLEAN");

// Injected transport: no network, no key. Mimics the Gemini response envelope.
const fakeTransport = async (_url: string, _headers: Record<string, string>, _body: unknown) => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ diagnosis: "HARNESS", failure_category: "Context Gap", confidence: 0.92, reasoning: "env withheld the jwt module", offending_step_index: 2 }) }] } }],
});
const verdict = await judgeTrajectory(traj, { transport: fakeTransport, backoffBase: 0 });
ok("judgeTrajectory returns a HARNESS verdict", verdict.diagnosis === "HARNESS" && (verdict.confidence ?? 0) > 0.9);

const filled = await judgeAndFill(JSON.parse(JSON.stringify(traj)) as Trajectory, { transport: fakeTransport, backoffBase: 0 });
ok("judgeAndFill writes outcome.verdict", filled.outcome.verdict?.diagnosis === "HARNESS");
ok("filled trajectory still validates", validate(filled).valid);

// retry path: transport fails once then succeeds
let calls = 0;
const flakyTransport = async (...a: [string, Record<string, string>, unknown]) => {
  calls++;
  if (calls === 1) throw new Error("HTTP 503");
  return fakeTransport(...a);
};
const retried = await judgeTrajectory(traj, { transport: flakyTransport, backoffBase: 0, maxRetries: 3 });
ok("judge retries a transient failure", retried.diagnosis === "HARNESS" && calls === 2);

// --- 7b. OTel GenAI bridge --------------------------------------------------
console.log("to-otel");
const otel = toOtel(traj) as any;
const rs = otel.resourceSpans?.[0];
const spans = rs?.scopeSpans?.[0]?.spans || [];
const attrMap = (a: any[]) => Object.fromEntries((a || []).map((x) => [x.key, x.value.stringValue ?? x.value.intValue ?? x.value.boolValue]));
ok("emits OTLP resourceSpans/scopeSpans", Array.isArray(otel.resourceSpans) && spans.length > 0);
ok("has a root invoke_agent span", spans.some((s: any) => s.name.startsWith("invoke_agent")));
const toolSpan = spans.find((s: any) => s.name.startsWith("execute_tool"));
ok("tool step -> execute_tool span", !!toolSpan);
ok("tool span has gen_ai.tool.name", attrMap(toolSpan?.attributes)["gen_ai.tool.name"] === "Bash");
ok("failed tool -> span status ERROR (2)", toolSpan?.status?.code === 2);
ok("failure trajectory -> root span ERROR", spans[0].status.code === 2);
ok("all spans share one traceId", new Set(spans.map((s: any) => s.traceId)).size === 1);
ok("tool span parents the root span", toolSpan?.parentSpanId === spans[0].spanId);
ok("deterministic ids (same in/out)", (toOtel(traj) as any).resourceSpans[0].scopeSpans[0].spans[0].spanId === spans[0].spanId);
// verdict carried as a vendor attribute (no OTel equivalent — the eval-first wedge)
const judgedOtel = toOtel({ ...traj, outcome: { status: "failure", verdict: { diagnosis: "HARNESS", category: "Context Gap", confidence: 0.9 } } } as any) as any;
const rootAttrs = attrMap(judgedOtel.resourceSpans[0].scopeSpans[0].spans[0].attributes);
ok("verdict.diagnosis -> opentrajectory.verdict.diagnosis attr", rootAttrs["opentrajectory.verdict.diagnosis"] === "HARNESS");

// --- 8. standard surface: schema + standalone CI validator agree ------------
console.log("standard");
const repoRoot = join(here, "../../..");
const { validate: validateMjs } = await import(join(repoRoot, "tools/ot-validate.mjs"));
const schema = JSON.parse(readFileSync(join(repoRoot, "schema/opentrajectory-0.1.schema.json"), "utf8"));

// the two validators (TS SDK + zero-dep CI .mjs) must agree, or CI and the SDK drift
const cases: unknown[] = [example, traj, cx,
  { ot_version: "0.1", trajectory_id: "t", harness: { name: "x" }, steps: [{ index: 0, role: "user" }], outcome: { status: "success" } },
  42, { ot_version: "0.1", harness: { name: "x" }, steps: [], outcome: { status: "success" } }, // missing trajectory_id
  { ot_version: "0.1", trajectory_id: "t", harness: { name: "x" }, steps: [{ index: 3, role: "user" }], outcome: { status: "success" } }, // bad index
];
let agree = true;
for (const c of cases) if (validate(c).valid !== validateMjs(c).valid) agree = false;
ok("SDK validator and zero-dep CI validator agree on all cases", agree);

// the JSON Schema's required fields must match what the validators enforce (anti-drift)
ok("schema top-level required matches spec §7", JSON.stringify([...schema.required].sort()) === JSON.stringify(["harness", "outcome", "ot_version", "steps", "trajectory_id"].sort()));
ok("schema requires tool_call name/args/success", JSON.stringify(schema.$defs.step.properties.tool_call.required.sort()) === JSON.stringify(["args", "name", "success"]));
ok("schema outcome.status enum matches", JSON.stringify(schema.$defs.outcome.properties.status.enum) === JSON.stringify(["success", "failure", "partial", "unknown"]));

// every shipped example/demo validates under the standalone validator
for (const rel of ["examples/hello.ot.json", "examples/hello-judged.ot.json", "bench/gold/gold.json"]) {
  const docs = JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
  const arr = Array.isArray(docs) ? docs : [docs];
  ok(`all docs in ${rel} are conformant`, arr.every((d: unknown) => validateMjs(d).valid));
}

// --- summary ----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
