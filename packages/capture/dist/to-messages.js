/** Flatten an OpenTrajectory into the OpenAI-style messages shape the Inspector ingests. */
export function toMessages(t) {
    const messages = [];
    for (const s of t.steps) {
        if (s.tool_call) {
            const tc = s.tool_call;
            messages.push({
                role: "assistant",
                content: s.message?.text ?? "",
                tool_calls: [
                    {
                        type: "function",
                        id: tc.id,
                        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
                    },
                ],
            });
            // tool result becomes a following `tool` message (Inspector reads role+content)
            if (tc.result !== undefined) {
                messages.push({ role: "tool", content: tc.result });
            }
        }
        else if (s.message) {
            messages.push({ role: s.role === "user" ? "user" : "assistant", content: s.message.text });
        }
    }
    return {
        trajectory_id: t.trajectory_id,
        task_id: t.task?.task_id,
        task_description: t.task?.description,
        repo: t.task?.repo,
        model: t.model,
        resolved: t.outcome.resolved ?? t.outcome.status === "success",
        messages,
    };
}
