#!/usr/bin/env node
// OpenTrajectory capture CLI. Zero runtime dependencies (node built-ins only).
//
//   ot capture <transcript.jsonl> [-o out.ot.json] [--id ID]   post-hoc capture from a Claude Code transcript
//   ot validate <file.ot.json|.ot.jsonl>                        conformance check (spec §7)
//   ot to-messages <file.ot.json> [-o out.json]                 convert to OpenAI-style messages (Inspector input)
//   ot hook                                                      live PostToolUse hook (reads stdin)
import { readFileSync, writeFileSync } from "node:fs";
import { captureFromTranscript } from "./from-claude-code.js";
import { validate } from "./validate.js";
import { toMessages } from "./to-messages.js";
import { runHook } from "./hook.js";
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
    if (!input) return fail("usage: ot capture <transcript.jsonl> [-o out.ot.json] [--id ID]");
    const traj = captureFromTranscript(readFileSync(input, "utf8"), { trajectoryId: arg(["--id"], rest) });
    const out = arg(["-o", "--out"], rest);
    const json = JSON.stringify(traj, null, 2);
    if (out) {
      writeFileSync(out, json);
      console.error(`wrote ${traj.steps.length} steps -> ${out} (status: ${traj.outcome.status})`);
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

  fail(
    "OpenTrajectory capture CLI\n" +
      "  ot capture <transcript.jsonl> [-o out.ot.json] [--id ID]\n" +
      "  ot validate <file.ot.json|.ot.jsonl>\n" +
      "  ot to-messages <file.ot.json> [-o out.json]\n" +
      "  ot hook   (live PostToolUse hook; reads stdin)",
  );
}

function fail(msg: string): void {
  console.error(msg);
  process.exit(1);
}

main();
