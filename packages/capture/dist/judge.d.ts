import type { Trajectory, Verdict } from "./types.js";
export declare const DEFAULT_MODEL = "gemini-2.5-flash";
export declare const JUDGE_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly diagnosis: {
            readonly type: "string";
            readonly enum: readonly ["HARNESS", "TRAINING", "PRODUCT", "BOTH", "CLEAN"];
        };
        readonly failure_category: {
            readonly type: "string";
        };
        readonly confidence: {
            readonly type: "number";
        };
        readonly reasoning: {
            readonly type: "string";
        };
        readonly offending_step_index: {
            readonly type: "integer";
        };
    };
    readonly required: readonly ["diagnosis", "failure_category", "confidence", "reasoning"];
};
/** Build the judge prompt for one OpenTrajectory document. */
export declare function buildJudgePrompt(traj: Trajectory): string;
/** Map a raw Gemini JSON response onto the spec's Verdict shape. */
export declare function parseVerdict(data: Record<string, unknown>, model?: string): Verdict;
export declare class JudgeError extends Error {
}
export type Transport = (url: string, headers: Record<string, string>, body: unknown) => Promise<unknown>;
export interface JudgeOptions {
    apiKey?: string;
    model?: string;
    transport?: Transport;
    maxRetries?: number;
    backoffBase?: number;
}
/** Rough Flash input-cost estimate (chars/4 tokens @ ~$0.075/1M). */
export declare function estimateCost(prompt: string): {
    tokens: number;
    usd: number;
};
/** Run the judge over a trajectory and return the Verdict (does not mutate). */
export declare function judgeTrajectory(traj: Trajectory, opts?: JudgeOptions): Promise<Verdict>;
/** Judge and write the verdict into outcome.verdict (returns the same object). */
export declare function judgeAndFill(traj: Trajectory, opts?: JudgeOptions): Promise<Trajectory>;
