#!/usr/bin/env node
// OpenTrajectory capture CLI. Zero runtime dependencies (node built-ins only).
//
//   ot capture <file.jsonl> [-o out] [--id ID] [--harness H]   capture from Claude Code OR Codex (auto-detected)
//   ot validate <file.ot.json|.ot.jsonl>                        conformance check (spec §7)
//   ot to-messages <file.ot.json> [-o out.json]                 convert to OpenAI-style messages (Inspector input)
//   ot judge <file.ot.json> [-o out] [--model M] [--dry-run]    fill outcome.verdict via the reference judge (Gemini)
//   ot hook                                                      live PostToolUse hook (reads stdin)
import { readFileSync, writeFileSync } from "node:fs";
import { captureFromTranscript } from "./from-claude-code.js";
import { captureFromRollout, looksLikeCodex } from "./from-codex.js";
import { validate } from "./validate.js";
import { toMessages } from "./to-messages.js";
import { runHook } from "./hook.js";
import { judgeAndFill, buildJudgePrompt, estimateCost } from "./judge.js";
import type { Trajectory } from "./types.js";

function arg(flags: string[], argv: string[]): string | undefined {
  for (const f of flags) {
    const i = argv.indexOf(f);
    if (i >= 0 && argv[i + 1]) return argv[i + 1];
  }
  return undefined;
}

function loadDocs(path: string): unknown[] {
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

function main(): void {
  const [, , cmd, ...rest] = process.argv;

  if (cmd === "hook") {
    runHook(process.stdin);
    return;
  }

  if (cmd === "capture") {
    const input = rest.find((a) => !a.startsWith("-"));
    if (!input) return fail("usage: ot capture <file.jsonl> [-o out.ot.json] [--id ID] [--harness claude-code|codex]");
    const text = readFileSync(input, "utf8");
    const id = arg(["--id"], rest);
    const forced = arg(["--harness"], rest);
    const harness = forced || (looksLikeCodex(text) ? "codex" : "claude-code");
    const traj =
      harness === "codex" || harness === "codex-cli"
        ? captureFromRollout(text, { trajectoryId: id })
        : captureFromTranscript(text, { trajectoryId: id });
    const out = arg(["-o", "--out"], rest);
    const json = JSON.stringify(traj, null, 2);
    if (out) {
      writeFileSync(out, json);
      console.error(`[${traj.harness.name}] wrote ${traj.steps.length} steps -> ${out} (status: ${traj.outcome.status})`);
    } else {
      process.stdout.write(json + "\n");
    }
    return;
  }

  if (cmd === "validate") {
    const input = rest.find((a) => !a.startsWith("-"));
    if (!input) return fail("usage: ot validate <file.ot.json|.ot.jsonl>");
    let bad = 0;
    loadDocs(input).forEach((doc, i) => {
      const r = validate(doc);
      if (r.valid) console.error(`✓ doc[${i}] conformant`);
      else {
        bad++;
        console.error(`✗ doc[${i}] invalid:\n    - ${r.errors.join("\n    - ")}`);
      }
    });
    process.exit(bad > 0 ? 1 : 0);
  }

  if (cmd === "to-messages") {
    const input = rest.find((a) => !a.startsWith("-"));
    if (!input) return fail("usage: ot to-messages <file.ot.json> [-o out.json]");
    const recs = loadDocs(input).map((d) => toMessages(d as Trajectory));
    const json = JSON.stringify(recs.length === 1 ? recs[0] : recs, null, 2);
    const out = arg(["-o", "--out"], rest);
    if (out) writeFileSync(out, json);
    else process.stdout.write(json + "\n");
    return;
  }

  if (cmd === "judge") {
    const input = rest.find((a) => !a.startsWith("-"));
    if (!input) return fail("usage: ot judge <file.ot.json> [-o out] [--model M] [--dry-run]");
    const traj = JSON.parse(readFileSync(input, "utf8")) as Trajectory;
    const model = arg(["--model"], rest);

    if (rest.includes("--dry-run")) {
      const prompt = buildJudgePrompt(traj);
      const c = estimateCost(prompt);
      console.error(`[dry-run] ~${c.tokens} input tokens · ~$${c.usd.toFixed(5)} (no API call)\n`);
      process.stdout.write(prompt + "\n");
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return fail("GEMINI_API_KEY is not set (use --dry-run to preview the prompt without calling the API)");
    judgeAndFill(traj, { apiKey, model })
      .then((judged) => {
        const out = arg(["-o", "--out"], rest) || input; // write back in place by default
        writeFileSync(out, JSON.stringify(judged, null, 2));
        const v = judged.outcome.verdict!;
        console.error(`verdict: ${v.diagnosis} (${v.category}) · conf ${v.confidence} · step ${v.offending_step_index ?? "—"} -> ${out}`);
      })
      .catch((e) => fail(String(e?.message || e)));
    return;
  }

  fail(
    "OpenTrajectory capture CLI\n" +
      "  ot capture <transcript.jsonl> [-o out.ot.json] [--id ID]\n" +
      "  ot validate <file.ot.json|.ot.jsonl>\n" +
      "  ot to-messages <file.ot.json> [-o out.json]\n" +
      "  ot judge <file.ot.json> [-o out] [--model M] [--dry-run]\n" +
      "  ot hook   (live PostToolUse hook; reads stdin)",
  );
}

function fail(msg: string): void {
  console.error(msg);
  process.exit(1);
}

main();
