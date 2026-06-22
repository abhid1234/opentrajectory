import type { Step } from "./types.js";
export interface PostToolUsePayload {
    session_id?: string;
    transcript_path?: string;
    cwd?: string;
    hook_event_name?: string;
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_response?: unknown;
}
/** Build a single OpenTrajectory step (index filled by the appender) from a hook payload. */
export declare function stepFromPayload(p: PostToolUsePayload): Omit<Step, "index">;
/** Sidecar path for a session's live trajectory steps. */
export declare function sidecarPath(p: PostToolUsePayload): string;
/** Append one step (as a JSONL line) to the session sidecar. Never throws. */
export declare function appendStep(p: PostToolUsePayload): void;
/** Read the whole hook payload from a stdin stream, then append a step. */
export declare function runHook(stdin: NodeJS.ReadStream): void;
