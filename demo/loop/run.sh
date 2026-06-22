#!/usr/bin/env bash
# A self-improvement loop, driven by OpenTrajectory diagnoses. Three turns on the
# SAME task: each turn fails for a DIFFERENT reason, the diagnosis names the lever,
# you pull it, and the loop converges to success. Offline (heuristic) — no API key.
# The LLM `ot judge` is the higher-precision version of the diagnose step.
# Run from the repo root: bash demo/loop/run.sh
set -e
OT="node packages/capture/dist/cli.js"
d="demo/loop"

turn () { # <file> <whatfailed> <fix>
  echo "── Turn: $2"
  echo "\$ ot diagnose $(basename "$1")"
  $OT diagnose "$1" | sed 's/^/   /'
  echo "   → fix the lever the diagnosis named: $3"
  echo
}

echo "TASK (fixed across all turns): make the auth test suite pass"
echo "═══════════════════════════════════════════════════════════════"
echo
turn "$d/1-harness.ot.json" "the run can't even start" \
  "HARNESS → fix the ENVIRONMENT (provision the 'jwt' dependency), not the model."
turn "$d/2-product.ot.json" "now it runs, but the fix is wrong" \
  "PRODUCT → a model CAPABILITY gap. Give it the missing context (point it at the refresh path)."
turn "$d/3-clean.ot.json" "resolved" \
  "none — CLEAN. The loop converged."

echo "═══════════════════════════════════════════════════════════════"
echo "Convergence:  HARNESS → PRODUCT → CLEAN"
echo "Levers pulled: fix the harness → improve the model's context → done"
echo
echo "The point: each turn failed for a DIFFERENT reason. A pass/fail score can't"
echo "tell them apart — so it can't tell you what to change. The DIAGNOSIS can, and"
echo "that's the steering signal a self-improvement loop runs on. Mis-attribute turn 1"
echo "as a model problem and you burn a fine-tuning run on a missing 'pip install'."
