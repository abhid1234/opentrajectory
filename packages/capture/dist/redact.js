// Shared redaction + text helpers for the capture adapters. Zero dependencies.
// Capturers redact secrets BEFORE a trajectory leaves the machine (spec §4).
export const MAX_RESULT_CHARS = 8000;
// Common secret shapes: OpenAI keys, GitHub tokens, Google API keys, PEM blocks.
export const SECRET_RE = /(sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_\-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g;
export function redact(s) {
    let redacted = false;
    const text = s.replace(SECRET_RE, () => {
        redacted = true;
        return "[REDACTED]";
    });
    return { text, redacted };
}
export function truncate(s, max = MAX_RESULT_CHARS) {
    return s.length > max ? s.slice(0, max) + "\n…[truncated]" : s;
}
/** Flatten a string or a content-block array ([{text}, …]) to plain text. */
export function asText(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        return content
            .map((b) => (b && typeof b === "object" && "text" in b ? String(b.text ?? "") : ""))
            .filter(Boolean)
            .join("\n");
    }
    return "";
}
