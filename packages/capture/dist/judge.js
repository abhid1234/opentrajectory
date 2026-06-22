export const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
const HEAD_STEPS = 6;
const TAIL_STEPS = 6;
const MAX_PROMPT_CHARS = 12000;
const VALID = new Set(["HARNESS", "TRAINING", "PRODUCT", "BOTH", "CLEAN"]);
// Verbatim from the auditor's validated judge prompt (src/judge/prompt.py).
const INSTRUCTIONS = `You are auditing one AI agent trajectory.
Apply this 4-point diagnostic and return ONLY JSON:
1. Could a human solve this with the SAME context? No  -> HARNESS (broken environment).
2. Did it earn the score via a shortcut/hack?      Yes -> TRAINING (fix reward/rubric).
3. Does it fail at a repeated decision fork?       Yes -> TRAINING (add coverage).
4. Otherwise classify as PRODUCT, BOTH, or CLEAN.
diagnosis must be one of: HARNESS, TRAINING, PRODUCT, BOTH, CLEAN.
offending_step_index = 0-based index of the steps[] entry that best exposes the
failure (or omit if none). Keep reasoning to 1-2 sentences.`;
// Gemini responseSchema (OpenAPI subset) for structured output.
export const JUDGE_SCHEMA = {
    type: "object",
    properties: {
        diagnosis: { type: "string", enum: ["HARNESS", "TRAINING", "PRODUCT", "BOTH", "CLEAN"] },
        failure_category: { type: "string" },
        confidence: { type: "number" },
        reasoning: { type: "string" },
        offending_step_index: { type: "integer" },
    },
    required: ["diagnosis", "failure_category", "confidence", "reasoning"],
};
function renderStep(s) {
    if (s.tool_call) {
        const tc = s.tool_call;
        const args = JSON.stringify(tc.args ?? {}).slice(0, 300);
        const res = (tc.result ?? "").slice(0, 400);
        return `${s.role} tool:${tc.name}(${args}) -> [${tc.success ? "ok" : "ERR"}] ${res}`;
    }
    if (s.decision)
        return `${s.role} decision[${s.decision.kind || "?"}]: ${s.decision.text}`;
    if (s.message)
        return `${s.role}: ${s.message.text.slice(0, 600)}`;
    return `${s.role}: (empty)`;
}
/** Head/tail window over steps, mirroring the auditor's prompt budgeting. */
function renderSteps(steps) {
    const line = (s) => `[${s.index}] ${renderStep(s)}`;
    let chosen;
    if (steps.length <= HEAD_STEPS + TAIL_STEPS) {
        chosen = steps.map(line);
    }
    else {
        const head = steps.slice(0, HEAD_STEPS).map(line);
        const tail = steps.slice(steps.length - TAIL_STEPS).map(line);
        const elided = steps.length - HEAD_STEPS - TAIL_STEPS;
        chosen = [...head, `[..] ... (${elided} steps elided) ...`, ...tail];
    }
    return chosen.join("\n");
}
/** Build the judge prompt for one OpenTrajectory document. */
export function buildJudgePrompt(traj) {
    let body = renderSteps(traj.steps);
    if (body.length > MAX_PROMPT_CHARS)
        body = body.slice(0, MAX_PROMPT_CHARS) + "\n... (truncated) ...";
    const o = traj.outcome || { status: "unknown" };
    return (`${INSTRUCTIONS}\n\n` +
        `TASK: ${traj.task?.description ?? ""}\n` +
        `HARNESS: ${traj.harness?.name ?? "?"}   MODEL: ${traj.model ?? "?"}\n` +
        `OUTCOME: status=${o.status}, resolved=${o.resolved}\n\n` +
        `STEPS:\n${body}\n`);
}
/** Map a raw Gemini JSON response onto the spec's Verdict shape. */
export function parseVerdict(data, model = DEFAULT_MODEL) {
    let diag = String(data.diagnosis ?? "").trim().toUpperCase();
    if (!VALID.has(diag))
        diag = "CLEAN";
    const omi = data.offending_step_index;
    const offending = typeof omi === "number" && Number.isFinite(omi) ? Math.trunc(omi) : null;
    let conf = Number(data.confidence);
    if (!Number.isFinite(conf))
        conf = 0;
    return {
        diagnosis: diag,
        category: String(data.failure_category ?? "Unknown") || "Unknown",
        confidence: conf,
        reasoning: String(data.reasoning ?? ""),
        offending_step_index: offending,
        evaluator: `opentrajectory/judge ${model}`,
    };
}
export class JudgeError extends Error {
}
// Default transport: Node built-in fetch. The API key rides in the
// x-goog-api-key header, never the URL (so timeouts/logs can't leak it).
const defaultTransport = async (url, headers, body) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    if (!res.ok)
        throw new JudgeError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
};
/** Rough Flash input-cost estimate (chars/4 tokens @ ~$0.075/1M). */
export function estimateCost(prompt) {
    const tokens = Math.ceil(prompt.length / 4);
    return { tokens, usd: (tokens / 1000) * 0.0003 };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Run the judge over a trajectory and return the Verdict (does not mutate). */
export async function judgeTrajectory(traj, opts = {}) {
    const model = opts.model || DEFAULT_MODEL;
    const transport = opts.transport || defaultTransport;
    const apiKey = opts.apiKey ?? "";
    if (transport === defaultTransport && !apiKey)
        throw new JudgeError("GEMINI_API_KEY is not set");
    const prompt = buildJudgePrompt(traj);
    const url = GEMINI_API.replace("{model}", model);
    const headers = { "x-goog-api-key": apiKey };
    const reqBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: JUDGE_SCHEMA },
    };
    const maxRetries = opts.maxRetries ?? 4;
    const backoff = opts.backoffBase ?? 800;
    let lastErr;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const resp = (await transport(url, headers, reqBody));
            const text = resp?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof text !== "string")
                throw new JudgeError("malformed response: no candidate text");
            return parseVerdict(JSON.parse(text), model);
        }
        catch (e) {
            lastErr = e;
            if (e instanceof SyntaxError)
                throw new JudgeError("malformed response: invalid JSON");
            if (attempt < maxRetries - 1 && backoff > 0)
                await sleep(backoff * 2 ** attempt);
        }
    }
    throw new JudgeError(`exhausted retries: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}
/** Judge and write the verdict into outcome.verdict (returns the same object). */
export async function judgeAndFill(traj, opts = {}) {
    const verdict = await judgeTrajectory(traj, opts);
    traj.outcome = { ...(traj.outcome || { status: "unknown" }), verdict };
    return traj;
}
