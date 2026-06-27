#!/usr/bin/env node
// Conformance corpus self-check (zero-dep, plain node — no build).
//   node conformance/check.mjs
// 1. every case validates under the SAME validator the CLI/Action use (spec §7), and
// 2. every case still demonstrates its `must` invariants (so the corpus can't silently rot), and
// 3. there are no orphan *.ot.json files missing from the manifest.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate } from "../tools/ot-validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };

// invariant token -> predicate over (doc, rawJsonString)
const checks = {
  "empty-steps": (d) => Array.isArray(d.steps) && d.steps.length === 0,
  "has-redacted-flag": (d) => d.steps.some((s) => s?.message?.redacted === true || s?.tool_call?.redacted === true),
  "has-redacted-placeholder": (_d, raw) => raw.includes("[REDACTED]"),
  "has-failed-tool": (d) => d.steps.some((s) => s?.tool_call && s.tool_call.success === false),
  "has-decision": (d) => d.steps.some((s) => s?.decision?.text),
  "has-verdict": (d) => Boolean(d.outcome?.verdict?.diagnosis),
  "has-tool": (d) => d.steps.some((s) => s?.tool_call?.name),
};
const dynamic = (token, d) => {
  if (token.startsWith("status:")) return d.outcome?.status === token.slice(7);
  if (token.startsWith("harness:")) return d.harness?.name === token.slice(8);
  const m = token.match(/^tools>=(\d+)$/);
  if (m) return d.steps.filter((s) => s?.tool_call?.name).length >= Number(m[1]);
  return null;
};

const listed = new Set();
for (const c of manifest.cases) {
  listed.add(c.file);
  const raw = readFileSync(join(here, c.file), "utf8");
  const doc = JSON.parse(raw);
  ok(validate(doc).valid, `${c.file}: not conformant — ${JSON.stringify(validate(doc).errors)}`);
  for (const token of c.must) {
    const fn = checks[token];
    const result = fn ? fn(doc, raw) : dynamic(token, doc);
    ok(result === true, `${c.file}: failed invariant "${token}"`);
  }
}

// no orphan corpus files outside the manifest
for (const f of readdirSync(here)) {
  if (f.endsWith(".ot.json")) ok(listed.has(f), `${f} exists but is not in manifest.json`);
}

console.log(`\nconformance: ${pass} passed, ${fail} failed (${manifest.cases.length} cases)`);
process.exit(fail ? 1 : 0);
