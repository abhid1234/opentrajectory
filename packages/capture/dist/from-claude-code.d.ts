import type { Trajectory } from "./types.js";
type RawEvent = Record<string, any>;
/** Parse JSONL text into ordered events, skipping blank/garbage lines. */
export declare function parseTranscript(jsonl: string): RawEvent[];
/**
 * Convert a parsed Claude Code transcript into one OpenTrajectory document.
 * Maps tool_use blocks -> steps, pairs tool_result by tool_use_id for success/result,
 * carries through model/usage/cost, and infers outcome.status.
 */
export declare function fromClaudeCode(events: RawEvent[], opts?: {
    trajectoryId?: string;
}): Trajectory;
/** Convenience: JSONL string -> Trajectory. */
export declare function captureFromTranscript(jsonl: string, opts?: {
    trajectoryId?: string;
}): Trajectory;
export {};
