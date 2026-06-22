// Zero-dependency test runner for @opentrajectory/capture.
// Run: node --import tsx test/run.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate } from "../src/validate.js";
import { captureFromTranscript, fromClaudeCode } from "../src/from-claude-code.js";
import { toMessages } from "../src/to-messages.js";
import { stepFromPayload } from "../src/hook.js";
import { buildJudgePrompt, parseVerdict, judgeTrajectory, judgeAndFill } from "../src/judge.js";
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

// --- summary ----------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
