// OpenTrajectory judge benchmark. Scores the offline heuristic (always) and the
// LLM judge (when GEMINI_API_KEY is set) against a labeled gold set, and reports
// the auditor's headline question: of the cases the cheap heuristic gets wrong,
// how many does the judge — which reads the trace — correct?
//
//   node --import tsx bench/score.ts                 # heuristic only (no key)
//   GEMINI_API_KEY=… node --import tsx bench/score.ts --judge
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { diagnoseHeuristic } from "../packages/capture/src/heuristic.js";
import { judgeTrajectory, buildJudgePrompt, estimateCost } from "../packages/capture/src/judge.js";

// Hard spend cap (USD). Each judge call is pre-estimated; we stop before exceeding it.
const MAX_USD = Number(process.env.OT_MAX_USD || "3");
const OUT_TOK_USD = (120 / 1000) * 0.0003; // small JSON verdict, repo-conservative rate
let spentEstUSD = 0;

const here = dirname(fileURLToPath(import.meta.url));
// gold set + output are overridable so the same harness can score a held-out set
const GOLD_PATH = process.env.OT_GOLD || join(here, "gold/gold.json");
const RESULTS_PATH = process.env.OT_RESULTS || join(here, "results.md");
const gold = JSON.parse(readFileSync(GOLD_PATH, "utf8")) as any[];
const CLASSES = ["HARNESS", "TRAINING", "PRODUCT", "BOTH", "CLEAN"];
const runJudge = process.argv.includes("--judge") || !!process.env.GEMINI_API_KEY;

function metrics(rows: { gold: string; pred: string }[]) {
  const n = rows.length;
  const correct = rows.filter((r) => r.gold === r.pred).length;
  const per: Record<string, { tp: number; fp: number; fn: number }> = {};
  for (const c of CLASSES) per[c] = { tp: 0, fp: 0, fn: 0 };
  for (const r of rows) {
    if (r.gold === r.pred) per[r.gold].tp++;
    else {
      if (per[r.pred]) per[r.pred].fp++;
      if (per[r.gold]) per[r.gold].fn++;
    }
  }
  return { n, correct, acc: correct / n, per };
}

function fmtPct(x: number) {
  return (x * 100).toFixed(1) + "%";
}

async function main() {
  const heur = gold.map((t) => ({ id: t.trajectory_id, gold: t.metadata.ground_truth.diagnosis, pred: diagnoseHeuristic(t).diagnosis, rationale: t.metadata.ground_truth.rationale }));
  const hm = metrics(heur);

  let judge: typeof heur | null = null;
  let jm: ReturnType<typeof metrics> | null = null;
  if (runJudge) {
    judge = [];
    for (const t of gold) {
      const estUSD = estimateCost(buildJudgePrompt(t)).usd + OUT_TOK_USD;
      if (spentEstUSD + estUSD > MAX_USD) {
        console.error(`[budget] stopping before ${t.trajectory_id}: would exceed $${MAX_USD} cap (spent ~$${spentEstUSD.toFixed(4)})`);
        judge.push({ id: t.trajectory_id, gold: t.metadata.ground_truth.diagnosis, pred: "SKIPPED_BUDGET", rationale: "" });
        continue;
      }
      try {
        const v = await judgeTrajectory(t, { apiKey: process.env.GEMINI_API_KEY });
        spentEstUSD += estUSD;
        judge.push({ id: t.trajectory_id, gold: t.metadata.ground_truth.diagnosis, pred: String(v.diagnosis), rationale: t.metadata.ground_truth.rationale });
      } catch (e) {
        judge.push({ id: t.trajectory_id, gold: t.metadata.ground_truth.diagnosis, pred: "ERROR", rationale: "" });
      }
    }
    console.error(`[budget] estimated spend this run: ~$${spentEstUSD.toFixed(4)} of $${MAX_USD} cap`);
    jm = metrics(judge);
  }

  // headline: of the heuristic's mistakes, how many does the judge fix?
  let corrected = 0, heuristicWrong = 0;
  if (judge) {
    for (let i = 0; i < heur.length; i++) {
      if (heur[i].gold !== heur[i].pred) {
        heuristicWrong++;
        if (judge[i].gold === judge[i].pred) corrected++;
      }
    }
  }

  // ---- report ----
  const L: string[] = [];
  L.push(`# OpenTrajectory judge benchmark — results\n`);
  L.push(`Gold set: **${gold.length}** canonical, author-labeled trajectories (Claude Code + Codex), covering HARNESS / TRAINING / PRODUCT / CLEAN, including 2 adversarial cases the simple heuristic is expected to miss.\n`);
  L.push(`> Honesty: this is a *diagnostic regression suite*, not a production sample. Labels are the author's, N is small. It measures whether the evaluators classify clear-cut and adversarial cases correctly — and where the heuristic's cheapness costs precision.\n`);
  L.push(`## Heuristic (offline, no key)\n`);
  L.push(`Accuracy: **${hm.correct}/${hm.n} = ${fmtPct(hm.acc)}**\n`);
  L.push(`| class | precision | recall |`);
  L.push(`|---|---|---|`);
  for (const c of CLASSES) {
    const p = hm.per[c]; const prec = p.tp + p.fp ? p.tp / (p.tp + p.fp) : NaN; const rec = p.tp + p.fn ? p.tp / (p.tp + p.fn) : NaN;
    if (p.tp + p.fp + p.fn > 0) L.push(`| ${c} | ${isNaN(prec) ? "—" : fmtPct(prec)} | ${isNaN(rec) ? "—" : fmtPct(rec)} |`);
  }
  L.push(`\nHeuristic misses:`);
  for (const r of heur.filter((r) => r.gold !== r.pred)) L.push(`- \`${r.id}\`: gold **${r.gold}**, heuristic said **${r.pred}** — ${r.rationale}`);
  if (heur.every((r) => r.gold === r.pred)) L.push(`- (none)`);

  if (jm && judge) {
    L.push(`\n## LLM judge (Gemini, reads the trace)\n`);
    L.push(`Accuracy: **${jm.correct}/${jm.n} = ${fmtPct(jm.acc)}**\n`);
    L.push(`Judge misses:`);
    for (const r of judge.filter((r) => r.gold !== r.pred)) L.push(`- \`${r.id}\`: gold **${r.gold}**, judge said **${r.pred}**`);
    if (judge.every((r) => r.gold === r.pred)) L.push(`- (none)`);
    L.push(`\n## Headline — does reading the trace help?\n`);
    L.push(`Of the **${heuristicWrong}** cases the heuristic got wrong, the judge corrected **${corrected}** (${heuristicWrong ? fmtPct(corrected / heuristicWrong) : "—"}).`);
  } else {
    L.push(`\n## LLM judge\n`);
    L.push(`Not run in this session (no \`GEMINI_API_KEY\`). Run \`GEMINI_API_KEY=… node --import tsx bench/score.ts --judge\` to measure the judge and the heuristic-vs-judge correction rate.`);
  }

  const report = L.join("\n") + "\n";
  writeFileSync(RESULTS_PATH, report);

  // console summary
  console.log(`heuristic: ${hm.correct}/${hm.n} = ${fmtPct(hm.acc)}`);
  if (jm) console.log(`judge: ${jm!.correct}/${jm!.n} = ${fmtPct(jm!.acc)} | corrected ${corrected}/${heuristicWrong} heuristic errors`);
  else console.log(`judge: skipped (set GEMINI_API_KEY)`);
  console.log("wrote " + RESULTS_PATH);
}

main();
