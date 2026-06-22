export declare const MAX_RESULT_CHARS = 8000;
export declare const SECRET_RE: RegExp;
export declare function redact(s: string): {
    text: string;
    redacted: boolean;
};
export declare function truncate(s: string, max?: number): string;
/** Flatten a string or a content-block array ([{text}, …]) to plain text. */
export declare function asText(content: unknown): string;
