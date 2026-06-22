import type { Trajectory } from "./types.js";
export interface OpenAIMessage {
    role: string;
    content: string;
    tool_calls?: {
        type: "function";
        id?: string;
        function: {
            name: string;
            arguments: string;
        };
    }[];
}
export interface MessagesRecord {
    trajectory_id: string;
    task_id?: string;
    task_description?: string;
    repo?: string;
    model?: string;
    resolved: boolean;
    messages: OpenAIMessage[];
    test_results?: {
        pred_passes_gen_tests?: number;
        pred_passes_gold_tests?: number;
    };
}
/** Flatten an OpenTrajectory into the OpenAI-style messages shape the Inspector ingests. */
export declare function toMessages(t: Trajectory): MessagesRecord;
