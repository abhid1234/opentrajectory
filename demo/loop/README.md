# The loop demo — diagnoses steering a multi-turn self-improvement loop

Recursive self-improvement in a runnable arc. The **same task** is attempted three times;
each turn fails for a **different reason**; the OpenTrajectory **diagnosis** names which lever
to pull; you pull it; the loop **converges** to success.

```bash
bash demo/loop/run.sh        # offline (heuristic) — no API key
```

## The arc

| Turn | What happened | Diagnosis | Lever the diagnosis chose |
|---|---|---|---|
| 1 | Can't import `jwt`; index unreachable | **HARNESS** (Context Gap) | Fix the **environment** — provision the dependency. *Not* the model. |
| 2 | Now it runs, but the fix is wrong | **PRODUCT** (capability gap) | Improve the **model's context** — point it at the real bug (the refresh path). |
| 3 | Tests pass, resolved | **CLEAN** | None. The loop converged. |

`HARNESS → PRODUCT → CLEAN` — three different failures, three different fixes, one task.

## Why it matters

A pass/fail score is the same shape on turn 1 and turn 2 — both are "failed." It cannot tell
you *what to change*, so it can't steer improvement. The diagnosis can: **"this is HARNESS, not
PRODUCT"** is the difference between `pip install` and a wasted fine-tuning run; **"this is
PRODUCT, not TRAINING"** is the difference between giving the model context and corrupting your
reward. That per-turn *why* is the steering signal a self-improvement loop runs on — and it's
exactly what OpenTrajectory captures and the diagnosis (heuristic here, the LLM
[`ot judge`](../../bench) for higher precision) turns into a decision.

This demo uses the offline heuristic so it runs with no key. The
[benchmark](../../bench) shows where the LLM judge earns the upgrade on the ambiguous cases.
