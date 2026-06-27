#!/usr/bin/env bash
# The wedge, end to end, in one terminal: a Claude Code run emits the open format,
# and the already-shipped Inspector's audit (here, its in-terminal heuristic twin
# `ot diagnose`) tells you *why* it failed. Open, cross-harness, eval-first.
#
# Reproducible + private-data-free: it captures a bundled, sanitized session
# fixture (demo/wedge-session.jsonl), not your real transcripts.
#
#   Record:  asciinema rec demo/wedge.cast -c "bash demo/wedge.sh"
#   Run:     bash demo/wedge.sh      (from the repo root)
set -e
OT="node packages/capture/dist/cli.js"
OUT="$(mktemp -d)/run.ot.json"
P='\033[0;36m'; B='\033[1m'; D='\033[2m'; G='\033[0;32m'; N='\033[0m'   # cyan/bold/dim/green/reset

say()  { printf "${P}# %s${N}\n" "$1"; sleep 0.7; }
run()  { printf "${B}\$ %s${N}\n" "$1"; sleep 0.5; eval "$2"; echo; sleep 0.9; }

printf "${B}OpenTrajectory — the wedge in one terminal${N}\n"
printf "${D}live agent run  →  one portable file  →  the Inspector tells you *why* it failed${N}\n\n"
sleep 1.2

say "0. Build the zero-dep capture SDK (Node built-ins only — corp-airlock safe)"
run "cd packages/capture && npm run build && cd ../.." "cd packages/capture && npm run build >/dev/null 2>&1 && cd ../.. && echo '   built dist/'"

say "1. Capture a Claude Code session transcript -> the open OpenTrajectory format"
run "ot capture demo/wedge-session.jsonl -o run.ot.json" "$OT capture demo/wedge-session.jsonl -o '$OUT'"

say "   one self-contained JSON file — ordered steps, tool calls, an outcome. Peek at it:"
run "jq '{harness:.harness.name, model, status:.outcome.status, steps:(.steps|length)}' run.ot.json" "jq '{harness:.harness.name, model, status:.outcome.status, steps:(.steps|length)}' '$OUT'"

say "2. It's conformant to the spec (§7) — gate this in any CI with the same check"
run "ot validate run.ot.json" "$OT validate '$OUT' | sed 's/^/   /'"

say "3. Audit it. ot diagnose is the in-terminal twin of the Inspector's heuristic —"
say "   same signal, no browser, no API key:"
run "ot diagnose run.ot.json" "$OT diagnose '$OUT' | sed 's/^/   /'"

printf "${G}${B}   ↑ not just 'it failed' — *why*: the env withheld a dependency (HARNESS), not a model gap.${N}\n\n"
sleep 1.4

say "Why that distinction is the whole game — same task, three turns, three different reasons:"
sleep 0.6
run "bash demo/loop/run.sh" "bash demo/loop/run.sh"

printf "${B}That's the wedge.${N} Every harness already records this spine; OpenTrajectory is the\n"
printf "one portable file they can all emit, and the Inspector is the validated reader that\n"
printf "already exists. Open, cross-harness, eval-first — ${D}not${N} the retraining loop.\n\n"
printf "${D}Drop the same run.ot.json into inspector/index.html (\"▲ Inspect yours\") for the\n"
printf "full visual audit + the LLM-judge column. Headless proof: node inspector/test-ingest.mjs${N}\n"
sleep 1.0
