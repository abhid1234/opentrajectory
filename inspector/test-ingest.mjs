// Headless test of the Inspector's OpenTrajectory ingestion path.
// Loads app.js in a stubbed browser env (node:vm) and asserts that a native
// .ot.json flows through normalizeLocal -> diagnoseLocal to a Context Gap
// diagnosis. Plain node, no extra deps. Run: node inspector/test-ingest.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "app.js"), "utf8");
const demo = JSON.parse(readFileSync(join(here, "demo.ot.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (n, c, d) => (c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.error("  ✗ " + n + (d ? " — " + d : ""))));

// Minimal browser stubs so app.js evaluates without a DOM.
const noopEl = new Proxy(function () {}, {
  get: (_t, k) => (k === "classList" ? { toggle() {}, add() {}, remove() {}, contains: () => false } : k === "style" ? {} : noopEl),
  set: () => true,
  apply: () => noopEl,
});
const sandbox = {
  console,
  setTimeout: () => {},
  clearTimeout: () => {},
  location: { search: "?notour", hash: "", href: "" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {} },
  fetch: () => Promise.reject(new Error("no network in test")),
  document: {
    body: noopEl, documentElement: noopEl,
    getElementById: () => noopEl, querySelector: () => noopEl, querySelectorAll: () => [],
    createElement: () => noopEl, addEventListener() {},
  },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app.js" });

const api = sandbox.window._rlta;
ok("app.js exposed _rlta", !!api && typeof api.normalizeLocal === "function");

// Native OpenTrajectory -> internal trace
const t = api.normalizeLocal(demo, 0);
ok("ot_version+steps recognized as OpenTrajectory", t.trajectory_id.startsWith("local-ot-"));
ok("harness surfaced", t.ot && t.ot.harness === "claude-code");
ok("tool calls captured", t.messages.some((m) => m.tools && m.tools.length && m.tools[0].name === "Bash"));
ok("tool results split into tool-role messages", t.messages.some((m) => m.role === "tool" && /ModuleNotFoundError/.test(m.content)));
ok("resolved=false carried from outcome", t.resolved === false);

// Heuristic diagnosis on the native trajectory
const d = api.diagnoseLocal(t);
ok("diagnoses a context/harness failure", d.diagnosis === "HARNESS" || d.category === "Context Gap", d.diagnosis + "/" + d.category);
ok("evidence cites a missing-context marker", d.evidence.some((e) => /No module|No such file|Permission denied/i.test(e)), JSON.stringify(d.evidence));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
