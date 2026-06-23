import type { Trajectory } from "./types.js";
type Run = Record<string, any>;
/** Flatten the input into an ordered run list, supporting the common export shapes:
 *  a flat array, a `{runs:[...]}` wrapper, or a nested root with `child_runs`. */
export declare function flattenRuns(input: unknown): Run[];
/** Convert a parsed LangGraph/LangSmith run tree into one OpenTrajectory document. */
export declare function fromLangGraph(input: unknown, opts?: {
    trajectoryId?: string;
}): Trajectory;
export declare function captureFromLangGraph(json: string, opts?: {
    trajectoryId?: string;
}): Trajectory;
/** Heuristic: does this look like a LangSmith run tree (runs carry `run_type`)? */
export declare function looksLikeLangGraph(text: string): boolean;
export {};
