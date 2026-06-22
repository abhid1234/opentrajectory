import type { Trajectory, Verdict } from "./types.js";
export interface HeuristicResult extends Verdict {
    evidence: string[];
}
/**
 * Diagnose an OpenTrajectory with the 4-point tree, no LLM:
 *   1. tool results show the environment withheld something + run didn't resolve -> HARNESS
 *   2. the agent edited a test / hardcoded / skipped to pass                      -> TRAINING
 *   3. both                                                                       -> BOTH
 *   4. resolved & clean -> CLEAN ; otherwise unclassified -> PRODUCT
 */
export declare function diagnoseHeuristic(traj: Trajectory): HeuristicResult;
