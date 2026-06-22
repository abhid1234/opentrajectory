import type { Trajectory } from "./types.js";
/** Convert a parsed Gemini CLI session object into one OpenTrajectory document. */
export declare function fromGemini(session: Record<string, any>, opts?: {
    trajectoryId?: string;
}): Trajectory;
/** Convenience: session JSON string -> Trajectory. */
export declare function captureFromGeminiSession(json: string, opts?: {
    trajectoryId?: string;
}): Trajectory;
/** Heuristic: does this text look like a Gemini CLI session (single JSON object)? */
export declare function looksLikeGemini(text: string): boolean;
