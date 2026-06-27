# Wedge demo — live Claude Code run → OpenTrajectory → Inspector audit

The whole point of OpenTrajectory in one loop: **a running agent emits the open format, and the already-shipped Inspector reads it and tells you *why* the run failed** — no harness lock-in, no backend.

## Watch it (recorded)

[`wedge.cast`](wedge.cast) is a real ~20s asciinema recording of the whole wedge in one terminal — capture → validate → audit → the three-turn convergence loop:

```bash
asciinema play demo/wedge.cast        # replay locally
agg demo/wedge.cast demo/wedge.gif    # optional: render to a GIF (needs asciinema-agg)
```

It's fully reproducible and contains no private data — it drives off a bundled, sanitized
session fixture ([`wedge-session.jsonl`](wedge-session.jsonl)), not your real transcripts.
Re-record or just run it live with:

```bash
bash demo/wedge.sh                                      # run the narrated demo
asciinema rec --overwrite -c "bash demo/wedge.sh" demo/wedge.cast   # re-record
```

## The 5-line version (post-hoc capture)

```bash
# 1. build the zero-dep capture SDK
cd packages/capture && npm run build && cd ../..
# 2. capture any Claude Code session transcript -> OpenTrajectory
node packages/capture/dist/cli.js capture ~/.claude/projects/<slug>/<session>.jsonl -o run.ot.json
# 3. validate it's conformant (spec §7)
node packages/capture/dist/cli.js validate run.ot.json
# 4. open the Inspector, click "▲ Inspect yours", drop run.ot.json  -> audited in-browser
```

That is a real, verified path: on this machine, step 2 turned a live 291-line Claude Code
transcript into a 95-step conformant `run.ot.json`.

## Live capture (the in-flight version)

Add the capture hook to `~/.claude/settings.json` so each tool call is emitted the instant it returns:

```json
{ "hooks": { "PostToolUse": [ { "matcher": "*", "hooks": [
  { "type": "command", "command": "node /ABS/PATH/opentrajectory/packages/capture/dist/cli.js hook" }
] } ] } }
```

Claude Code pipes each `PostToolUse` payload to the hook, which appends one OpenTrajectory
step to `<transcript_dir>/<session>.ot.jsonl`. The hook never blocks the agent (always exits 0).

## The Inspector reading the open format

`inspector/demo.ot.json` is a native OpenTrajectory file (a Claude Code run that fails on a
missing dependency). The Inspector boots straight into it — `normalizeLocal()` detects
`ot_version` + `steps` and ingests it directly (no conversion). The heuristic correctly
diagnoses a **Context Gap / harness** failure and cites the `ModuleNotFoundError` /
`No such file` evidence. Try it: open the Inspector preview, or run
`node inspector/test-ingest.mjs` to see the same path asserted headlessly.

## Why this is the wedge

Every harness already records the same spine (ordered steps, tool name/args/result/success).
OpenTrajectory is the **one portable file** they can all emit, and the Inspector is the
validated reader/scorer that already exists. Capture + format + Inspector-reads-it — open,
cross-harness, eval-first. (Not the retraining loop — that's the funded incumbents' lane.)
