#!/usr/bin/env node
// OpenTrajectory capture CLI. Zero runtime dependencies (node built-ins only).
//
//   ot capture <file> [-o out] [--id ID] [--harness H]         capture from Claude Code / Codex / Antigravity (auto-detected)
//   ot validate <file.ot.json|.ot.jsonl>                        conformance check (spec §7)
//   ot to-messages <file.ot.json> [-o out.json]                 convert to OpenAI-style messages (Inspector input)
//   ot to-otel <file.ot.json> [-o out.json]                     convert to OpenTelemetry GenAI spans (OTLP/JSON)
//   ot diagnose <file.ot.json>                                  offline heuristic diagnosis (no API key)
//   ot judge <file.ot.json> [-o out] [--model M] [--dry-run]    fill outcome.verdict via the reference judge (Gemini)
//   ot hook                                                      live PostToolUse hook (reads stdin)
import { readFileSync, writeFileSync } from "node:fs";
import { captureFromTranscript } from "./from-claude-code.js";
import { captureFromRollout, looksLikeCodex } from "./from-codex.js";
import { captureFromGeminiSession, looksLikeGemini } from "./from-gemini.js";
import { captureFromLangGraph, looksLikeLangGraph } from "./from-langgraph.js";
import { validate } from "./validate.js";
import { toMessages } from "./to-messages.js";
import { runHook } from "./hook.js";
import { judgeAndFill, buildJudgePrompt, estimateCost } from "./judge.js";
import { diagnoseHeuristic } from "./heuristic.js";
import { toOtel } from "./to-otel.js";
function arg(flags, argv) {
    for (const f of flags) {
        const i = argv.indexOf(f);
        if (i >= 0 && argv[i + 1])
            return argv[i + 1];
    }
    return undefined;
}
function loadDocs(path) {
    const text = readFileSync(path, "utf8");
    if (path.endsWith(".jsonl")) {
        return text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => JSON.parse(l));
    }
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [data];
}
function main() {
    const [, , cmd, ...rest] = process.argv;
    if (cmd === "hook") {
        runHook(process.stdin);
        return;
    }
    if (cmd === "capture") {
        const input = rest.find((a) => !a.startsWith("-"));
        if (!input)
            return fail("usage: ot capture <file> [-o out.ot.json] [--id ID] [--harness claude-code|codex|antigravity|langgraph]");
        const text = readFileSync(input, "utf8");
        const id = arg(["--id"], rest);
        const forced = arg(["--harness"], rest);
        const harness = forced ||
            (looksLikeLangGraph(text) ? "langgraph" : looksLikeGemini(text) ? "antigravity" : looksLikeCodex(text) ? "codex" : "claude-code");
        const traj = harness === "langgraph"
            ? captureFromLangGraph(text, { trajectoryId: id })
            : harness === "antigravity" || harness === "gemini"
                ? captureFromGeminiSession(text, { trajectoryId: id })
                : harness === "codex" || harness === "codex-cli"
                    ? captureFromRollout(text, { trajectoryId: id })
                    : captureFromTranscript(text, { trajectoryId: id });
        const out = arg(["-o", "--out"], rest);
        const json = JSON.stringify(traj, null, 2);
        if (out) {
            writeFileSync(out, json);
            console.error(`[${traj.harness.name}] wrote ${traj.steps.length} steps -> ${out} (status: ${traj.outcome.status})`);
        }
        else {
            process.stdout.write(json + "\n");
        }
        return;
    }
    if (cmd === "validate") {
        const input = rest.find((a) => !a.startsWith("-"));
        if (!input)
            return fail("usage: ot validate <file.ot.json|.ot.jsonl>");
        let bad = 0;
        loadDocs(input).forEach((doc, i) => {
            const r = validate(doc);
            if (r.valid)
                console.error(`✓ doc[${i}] conformant`);
            else {
                bad++;
                console.error(`✗ doc[${i}] invalid:\n    - ${r.errors.join("\n    - ")}`);
            }
        });
        process.exit(bad > 0 ? 1 : 0);
    }
    if (cmd === "to-messages") {
        const input = rest.find((a) => !a.startsWith("-"));
        if (!input)
            return fail("usage: ot to-messages <file.ot.json> [-o out.json]");
        const recs = loadDocs(input).map((d) => toMessages(d));
        const json = JSON.stringify(recs.length === 1 ? recs[0] : recs, null, 2);
        const out = arg(["-o", "--out"], rest);
        if (out)
            writeFileSync(out, json);
        else
            process.stdout.write(json + "\n");
        return;
    }
    if (cmd === "to-otel") {
        const input = rest.find((a) => !a.startsWith("-"));
        if (!input)
            return fail("usage: ot to-otel <file.ot.json> [-o out.json]   (OTLP/JSON for any OTel collector)");
        const out = arg(["-o", "--out"], rest);
        const traces = loadDocs(input).map((d) => toOtel(d));
        const json = JSON.stringify(traces.length === 1 ? traces[0] : traces, null, 2);
        if (out)
            writeFileSync(out, json);
        else
            process.stdout.write(json + "\n");
        return;
    }
    if (cmd === "diagnose") {
        const input = rest.find((a) => !a.startsWith("-"));
        if (!input)
            return fail("usage: ot diagnose <file.ot.json>   (offline heuristic, no API key)");
        const traj = JSON.parse(readFileSync(input, "utf8"));
        const h = diagnoseHeuristic(traj);
        process.stdout.write(`${h.diagnosis} (${h.category}) · conf ${h.confidence}\n`);
        for (const e of h.evidence)
            process.stdout.write(`  - ${e}\n`);
        return;
    }
    if (cmd === "judge") {
        const input = rest.find((a) => !a.startsWith("-"));
        if (!input)
            return fail("usage: ot judge <file.ot.json|.ot.jsonl> [-o out] [--model M] [--dry-run]");
        const isJsonl = input.endsWith(".jsonl");
        // handle single object, a JSON array, or .jsonl — judge each trajectory in the file
        const docs = loadDocs(input);
        if (!docs.length)
            return fail("no trajectories found in " + input);
        const wasArray = isJsonl || /^\s*\[/.test(readFileSync(input, "utf8"));
        const model = arg(["--model"], rest);
        if (rest.includes("--dry-run")) {
            let tokens = 0, usd = 0;
            docs.forEach((t, i) => {
                const c = estimateCost(buildJudgePrompt(t));
                tokens += c.tokens;
                usd += c.usd;
                if (i === 0)
                    process.stdout.write(buildJudgePrompt(t) + "\n");
            });
            console.error(`[dry-run] ${docs.length} trajector${docs.length === 1 ? "y" : "ies"} · ~${tokens} input tokens · ~$${usd.toFixed(5)} total (no API call; prompt above is doc[0])`);
            return;
        }
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey)
            return fail("GEMINI_API_KEY is not set (use --dry-run to preview the prompt without calling the API)");
        (async () => {
            const judged = [];
            for (let i = 0; i < docs.length; i++) {
                const j = await judgeAndFill(docs[i], { apiKey, model });
                judged.push(j);
                const v = j.outcome.verdict;
                const id = j.trajectory_id || j.task?.task_id || "—";
                console.error(`[${i + 1}/${docs.length}] ${id}: ${v.diagnosis} (${v.category}) · conf ${v.confidence} · step ${v.offending_step_index ?? "—"}`);
            }
            const out = arg(["-o", "--out"], rest) || input; // write back in place by default
            if (isJsonl)
                writeFileSync(out, judged.map((d) => JSON.stringify(d)).join("\n") + "\n");
            else
                writeFileSync(out, JSON.stringify(wasArray ? judged : judged[0], null, 2));
            console.error(`wrote ${judged.length} judged trajector${judged.length === 1 ? "y" : "ies"} -> ${out}`);
        })().catch((e) => fail(String(e?.message || e)));
        return;
    }
    fail("OpenTrajectory capture CLI\n" +
        "  ot capture <transcript.jsonl> [-o out.ot.json] [--id ID]\n" +
        "  ot validate <file.ot.json|.ot.jsonl>\n" +
        "  ot to-messages <file.ot.json> [-o out.json]\n" +
        "  ot to-otel <file.ot.json> [-o out.json]   (OpenTelemetry GenAI spans)\n" +
        "  ot diagnose <file.ot.json>   (offline heuristic, no key)\n" +
        "  ot judge <file.ot.json> [-o out] [--model M] [--dry-run]\n" +
        "  ot hook   (live PostToolUse hook; reads stdin)");
}
function fail(msg) {
    console.error(msg);
    process.exit(1);
}
main();
