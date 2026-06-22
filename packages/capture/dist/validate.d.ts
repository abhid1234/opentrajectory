import type { Trajectory } from "./types.js";
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * Validates an unknown value against OpenTrajectory v0.1 conformance (spec §7):
 *  - ot_version, trajectory_id, harness.name, steps, outcome.status present
 *  - every steps[i].index === i (0-based position)
 *  - every tool_call (where present) has name, args (object), success (boolean)
 */
export declare function validate(doc: unknown): ValidationResult;
/** Throwing variant — returns the doc typed as Trajectory or throws with all errors. */
export declare function assertValid(doc: unknown): Trajectory;
