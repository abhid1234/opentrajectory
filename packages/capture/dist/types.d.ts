export declare const OT_VERSION = "0.1";
export interface Harness {
    name: string;
    version?: string;
}
export interface Task {
    task_id?: string;
    description?: string;
    repo?: string;
}
export interface Message {
    text: string;
    redacted?: boolean;
}
export interface ToolCall {
    id?: string;
    name: string;
    args: Record<string, unknown>;
    args_text?: string;
    result?: string;
    success: boolean;
    error?: string;
    duration_ms?: number;
    redacted?: boolean;
}
export type DecisionKind = "plan" | "retry" | "branch" | "give_up" | "other";
export interface Decision {
    text: string;
    kind?: DecisionKind;
}
export type StepRole = "assistant" | "user" | "tool" | "system" | "subagent";
export interface Step {
    index: number;
    role: StepRole;
    ts?: string;
    parent_index?: number | null;
    is_subagent?: boolean;
    message?: Message;
    tool_call?: ToolCall;
    decision?: Decision;
}
export type OutcomeStatus = "success" | "failure" | "partial" | "unknown";
export type Diagnosis = "HARNESS" | "TRAINING" | "PRODUCT" | "BOTH" | "CLEAN";
export interface Verdict {
    diagnosis?: Diagnosis | string;
    category?: string;
    confidence?: number;
    reasoning?: string;
    offending_step_index?: number | null;
    evaluator?: string;
}
export interface Outcome {
    status: OutcomeStatus;
    resolved?: boolean;
    verdict?: Verdict;
}
export interface Cost {
    input_tokens?: number;
    output_tokens?: number;
    usd?: number;
}
export interface Trajectory {
    ot_version: string;
    trajectory_id: string;
    harness: Harness;
    task?: Task;
    model?: string;
    started_at?: string;
    ended_at?: string;
    steps: Step[];
    outcome: Outcome;
    cost?: Cost;
    metadata?: Record<string, unknown>;
    extensions?: Record<string, unknown>;
    raw?: Record<string, unknown>;
}
