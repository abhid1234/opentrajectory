#!/usr/bin/env node
// Self-contained OpenTrajectory v0.1 conformance validator. Zero dependencies,
// no build step — runs on plain Node. This is what the GitHub Action and any
// adopter's CI runs to gate trajectories. Mirrors spec §7 (and packages/capture
// src/validate.ts — kept in sync by a cross-check test).
//
//   node tools/ot-validate.mjs <file-or-dir> [more...]
// Recurses directories for *.ot.json / *.ot.jsonl (and plain .json holding an
// OpenTrajectory object or array). Exits non-zero if any document is non-conformant.
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

export function validate(doc) {
  const errors = [];
  if (!isObj(doc)) return { valid: false, errors: ["document is not a JSON object"] };
  if (typeof doc.ot_version !== "string") errors.push("missing/invalid `ot_version`");
  if (typeof doc.trajectory_id !== "string" || !doc.trajectory_id) errors.push("missing/invalid `trajectory_id`");
  if (!isObj(doc.harness) || typeof doc.harness.name !== "string") errors.push("missing/invalid `harness.name`");
  if (!Array.isArray(doc.steps)) errors.push("missing/invalid `steps`");
  else
    doc.steps.forEach((s, i) => {
      if (!isObj(s)) return errors.push(`steps[${i}] is not an object`);
      if (s.index !== i) errors.push(`steps[${i}].index must equal ${i}`);
      if (typeof s.role !== "string") errors.push(`steps[${i}].role must be a string`);
      if (s.tool_call !== undefined) {
        const tc = s.tool_call;
        if (!isObj(tc)) errors.push(`steps[${i}].tool_call is not an object`);
        else {
          if (typeof tc.name !== "string" || !tc.name) errors.push(`steps[${i}].tool_call.name must be a non-empty string`);
          if (!isObj(tc.args)) errors.push(`steps[${i}].tool_call.args must be an object`);
          if (typeof tc.success !== "boolean") errors.push(`steps[${i}].tool_call.success must be a boolean`);
        }
      }
    });
  if (!isObj(doc.outcome) || typeof doc.outcome.status !== "string") errors.push("missing/invalid `outcome.status`");
  else if (!["success", "failure", "partial", "unknown"].includes(doc.outcome.status))
    errors.push("outcome.status must be success|failure|partial|unknown");
  return { valid: errors.length === 0, errors };
}

function docsFromFile(path) {
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".jsonl")) return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [data];
}

function* walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) yield* walk(join(p, e));
  } else if (/\.ot\.jsonl?$/.test(p) || p.endsWith(".ot.json")) {
    yield p;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("usage: node tools/ot-validate.mjs <file-or-dir> [more...]");
    process.exit(2);
  }
  let files = [];
  for (const a of args) {
    const st = statSync(a);
    if (st.isDirectory()) files.push(...walk(a));
    else files.push(a); // explicit file: validate even if not *.ot.json
  }
  if (!files.length) {
    console.log("no OpenTrajectory files found (looked for *.ot.json / *.ot.jsonl)");
    return;
  }
  let bad = 0,
    total = 0;
  for (const f of files) {
    let docs;
    try {
      docs = docsFromFile(f);
    } catch (e) {
      console.error(`✗ ${f}: not valid JSON — ${e.message}`);
      bad++;
      continue;
    }
    docs.forEach((d, i) => {
      total++;
      const r = validate(d);
      const tag = docs.length > 1 ? `${f}[${i}]` : f;
      if (r.valid) console.log(`✓ ${tag}`);
      else {
        bad++;
        console.error(`✗ ${tag}:\n    - ${r.errors.join("\n    - ")}`);
      }
    });
  }
  console.log(`\n${total - bad}/${total} conformant`);
  process.exit(bad ? 1 : 0);
}

// run only when invoked directly (so tests can import validate())
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
