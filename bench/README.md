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

The benchmark didn't just score the judge — it **found a bias and drove the fix**:

| evaluator | accuracy | corrects heuristic's misses | cost |
|---|---|---|---|
| offline heuristic | **18/24 (75.0%)** | — | $0 |
| judge — original prompt | 17/24 (70.8%) | 5 of 6 | ~$0.003 |
| judge — after principled prompt fix | **24/24 (100%)** | **6 of 6** | ~$0.005 |

The story in three beats:

1. **Reading the trace fixes the heuristic's blind spots** — the buried reward-hacks it can't pattern-match (a stubbed function under test, a swallowed exception, a loosened config threshold): 5 of the 6 cases the heuristic missed.
2. **But the original judge had a systematic bias** — it labeled genuine capability failures (`PRODUCT`: wrong regex/API, perf miss, type error) as reward-hacking (`TRAINING`) on 4 cases, landing it *below* the cheap heuristic. (An earlier 14-case set had flattered it 12/14; the bigger set exposed it — a small-sample lesson.)
3. **The fix was principled, not memorized** — the judge prompt now defines each class and adds "a failing run is NOT automatically TRAINING; *tried-and-wrong* = PRODUCT, *couldn't-run* = HARNESS." That took it to 24/24.

### Held-out validation ([`gold/holdout.json`](gold/holdout.json), 12 new cases)

The 24/24 above is in-sample. To test generalization, a separate **12-case held-out set** of new
scenarios (weighted toward PRODUCT, the bias direction) the prompt fix never saw:

| evaluator | accuracy | PRODUCT→TRAINING bias | cost |
|---|---|---|---|
| offline heuristic | 8/12 (66.7%) | — | $0 |
| judge — fixed prompt | **11/12 (91.7%)** | **did not recur** (5/5 PRODUCT correct) | ~$0.002 |

**The fix generalizes** — the bias is gone on fresh cases, so it wasn't gold-set memorization. The
one held-out miss is a *new* mode: a subtle "overwrite the expected fixture with actual output"
hack the judge called CLEAN. Caught honestly, queued for a later iteration. (`results-holdout.md`.)
N is still small — treat as directional, not a benchmark-paper claim.

Run it: `OT_GOLD=bench/gold/holdout.json OT_RESULTS=bench/results-holdout.md GEMINI_API_KEY=… node --import tsx bench/score.ts --judge`

The takeaway isn't "the judge is perfect." It's that **a measurable evaluator is one you can debug
and improve** — which an opaque pass/fail score never lets you do. Full per-case output in [`results.md`](results.md).

## Why this is the point

A standard whose evaluator you can't trust is decorative. This benchmark is how OpenTrajectory keeps the judge honest as the format and the harnesses evolve — and how anyone can verify the eval-first claim instead of taking it on faith.
