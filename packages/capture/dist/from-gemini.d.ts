import type { Trajectory } from "./types.js";
/** Convert a parsed Antigravity CLI session object into one OpenTrajectory document. */
export declare function fromGemini(session: Record<string, any>, opts?: {
    trajectoryId?: string;
}): Trajectory;
/** Convenience: session JSON string -> Trajectory. */
export declare function captureFromGeminiSession(json: string, opts?: {
    trajectoryId?: string;
}): Trajectory;
/** Heuristic: does this text look like a Antigravity CLI session (single JSON object)? */
export declare function looksLikeGemini(text: string): boolean;
