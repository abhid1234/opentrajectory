# OpenTrajectory judge benchmark

Does the evaluator actually work on OpenTrajectory data — and does **reading the trace** (the LLM judge) beat the **cheap heuristic**? This benchmark measures it, on the format itself.

## What it is (and isn't)

- **Is:** a labeled diagnostic suite of **14 canonical trajectories** (Claude Code + Codex) covering HARNESS / TRAINING / PRODUCT / CLEAN, including **2 adversarial cases** designed to be ambiguous — where the cheap heuristic is *expected* to fail.
- **Isn't:** a production sample. The labels are the author's, N is small, and the cases are hand-authored to exercise the taxonomy (not sampled from real users — that would raise privacy issues). Treat it as a **regression suite + an honest illustration**, not a population estimate.

Each gold trajectory carries `metadata.ground_truth = { diagnosis, rationale }`.

## Run it

```bash
# heuristic only — offline, no key, real numbers now
node --import tsx bench/score.ts

# add the LLM judge + the heuristic-vs-judge correction rate
GEMINI_API_KEY=… node --import tsx bench/score.ts --judge
```

Writes [`results.md`](results.md).

## Measured result (24-case set, this repo)

| evaluator | accuracy | corrects heuristic's misses | cost |
|---|---|---|---|
| offline heuristic | **18/24 (75.0%)** | — | $0 |
| LLM judge (Gemini 2.5 Flash) | **17/24 (70.8%)** | **5 of 6** | ~$0.003 |

The headline isn't "the judge wins" — it's "**the benchmark catches what a demo can't.**"

- Reading the trace **fixes the heuristic's blind spots**: the buried reward-hacks it can't pattern-match (a stubbed function under test, a swallowed exception, a loosened config threshold) — 5 of the 6 cases the heuristic missed.
- But the judge has a **systematic bias**: it labels genuine capability failures (`PRODUCT` — wrong regex, wrong API, perf miss, type error) as reward-hacking (`TRAINING`) on **4 cases**. It confuses *can't* with *cheating*.
- Net: the judge lands **slightly below** the cheap heuristic on this set. An earlier 14-case set flattered it (12/14 vs 11/14, "corrects 3/3"); expanding to 24 held-out cases exposed the bias — a textbook small-sample lesson.

**Neither evaluator is trustworthy alone.** The value of the bench is telling you exactly *where* each fails, so the next move is targeted: a judge prompt that separates "the model couldn't" from "the model gamed it." Full per-case output in [`results.md`](results.md).

## Why this is the point

A standard whose evaluator you can't trust is decorative. This benchmark is how OpenTrajectory keeps the judge honest as the format and the harnesses evolve — and how anyone can verify the eval-first claim instead of taking it on faith.
