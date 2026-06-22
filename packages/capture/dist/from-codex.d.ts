import type { Trajectory } from "./types.js";
type RawEvent = Record<string, any>;
/** Parse rollout JSONL into ordered events, skipping blank/garbage lines. */
export declare function parseRollout(jsonl: string): RawEvent[];
/**
 * Convert parsed Codex rollout events into one OpenTrajectory document.
 * Pairs function_call/function_call_output by call_id; skips encrypted
 * reasoning items; pulls the task from the first real user prompt.
 */
export declare function fromCodex(events: RawEvent[], opts?: {
    trajectoryId?: string;
}): Trajectory;
/** Convenience: rollout JSONL string -> Trajectory. */
export declare function captureFromRollout(jsonl: string, opts?: {
    trajectoryId?: string;
}): Trajectory;
/** Heuristic: does this JSONL look like a Codex rollout (vs a Claude Code transcript)? */
export declare function looksLikeCodex(jsonl: string): boolean;
export {};
