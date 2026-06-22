#!/usr/bin/env bash
# One turn of the self-improvement loop, driven by an OpenTrajectory diagnosis.
# Offline (heuristic) — no API key needed. The judge (ot judge) is the higher-precision
# version of the same step. Run from the repo root: bash demo/loop/run.sh
set -e
OT="node packages/capture/dist/cli.js"
here="demo/loop"

echo "── Turn 1: the agent runs the task ───────────────────────────────"
echo "task: make the auth test suite pass"
echo
echo "\$ ot diagnose 1-fail.ot.json"
$OT diagnose "$here/1-fail.ot.json"
echo
echo "→ Diagnosis is HARNESS (Context Gap): the ENVIRONMENT withheld the 'jwt'"
echo "  dependency. The fix is NOT 'retrain the model' or 'edit the agent' —"
echo "  it's 'provision the dependency in the harness.' The diagnosis tells you"
echo "  WHICH lever to pull."
echo
echo "── Apply the targeted fix the diagnosis implies ──────────────────"
echo "  (provision 'jwt' in the sandbox — a harness fix, not a model change)"
echo
echo "── Turn 2: re-run the SAME task with the SAME model ──────────────"
echo "\$ ot diagnose 2-pass.ot.json"
$OT diagnose "$here/2-pass.ot.json"
echo
echo "→ CLEAN, resolved. The loop closed: a trajectory exposed the failure,"
echo "  the diagnosis pointed at the harness, the harness fix landed, and the"
echo "  next trajectory passes. That feedback signal — *why* it failed, not just"
echo "  *that* it failed — is what a self-improvement loop runs on."
