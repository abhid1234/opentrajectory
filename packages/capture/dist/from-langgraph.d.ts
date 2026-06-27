import type { Trajectory } from "./types.js";
type Run = Record<string, any>;
/** Flatten the input into an ordered run list, supporting the real export shapes:
 *  a `{runs:[...]}` wrapper, a nested root with `child_runs`, a flat list ordered by
 *  `dotted_order`, or a flat list linked only by `parent_run_id`. Tree order is
 *  reconstructed (depth-first) rather than trusting wall-clock `start_time`. */
export declare function flattenRuns(input: unknown): Run[];
/** LangSmith ingestion batch shape: `{ post:[creates], patch:[updates] }`. Real exports from
 *  the multipart ingest endpoint / wrap_openai arrive this way — `post` holds the run with its
 *  inputs, `patch` carries the final outputs/end_time/error keyed by the same id. Merge them
 *  back into a single run list (patch values win, except empties). Anything else passes through. */
export declare function normalizeIngestBatch(input: unknown): unknown;
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
