# The loop demo — a diagnosis driving a self-improvement turn

The recursive-self-improvement story in one runnable turn. An agent run fails; an
OpenTrajectory **diagnosis** says *why*; that *why* tells you **which lever to pull**;
you pull it; the next run passes.

```bash
bash demo/loop/run.sh        # offline (heuristic) — no API key
```

## The turn

1. **Turn 1 fails** — `1-fail.ot.json`: the agent can't import `jwt`; the package index is unreachable.
2. **Diagnose** — `ot diagnose 1-fail.ot.json` → **HARNESS (Context Gap)**. The signal isn't "the model is bad" — it's "the *environment* withheld a dependency."
3. **Targeted fix** — because the diagnosis is HARNESS, you fix the **harness** (provision `jwt`), not the model or the agent. The diagnosis chose the lever.
4. **Turn 2 passes** — `2-pass.ot.json`: same task, same model, only the harness changed → **CLEAN, resolved**.

## Why it matters

A self-improvement loop is only as good as the signal that steers it. "Pass rate dropped"
tells you nothing about *what to change*. **"This failure is HARNESS, not TRAINING"** tells you
to fix the sandbox instead of burning a fine-tuning run on a model that was never the problem.
OpenTrajectory captures the trace in an open format; the diagnosis (heuristic here, the LLM
`ot judge` for higher precision — see [`../../bench`](../../bench)) turns it into that steering signal.

This demo uses the offline heuristic so it runs with no key. `ot judge` is the same step at
higher precision; the [benchmark](../../bench) shows where it earns the upgrade.
