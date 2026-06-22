/**
 * Validates an unknown value against OpenTrajectory v0.1 conformance (spec §7):
 *  - ot_version, trajectory_id, harness.name, steps, outcome.status present
 *  - every steps[i].index === i (0-based position)
 *  - every tool_call (where present) has name, args (object), success (boolean)
 */
export function validate(doc) {
    const errors = [];
    const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
    if (!isObj(doc)) {
        return { valid: false, errors: ["document is not a JSON object"] };
    }
    if (typeof doc.ot_version !== "string")
        errors.push("missing/invalid `ot_version` (string)");
    if (typeof doc.trajectory_id !== "string" || doc.trajectory_id.length === 0)
        errors.push("missing/invalid `trajectory_id` (non-empty string)");
    if (!isObj(doc.harness) || typeof doc.harness.name !== "string") {
        errors.push("missing/invalid `harness.name` (string)");
    }
    if (!Array.isArray(doc.steps)) {
        errors.push("missing/invalid `steps` (array)");
    }
    else {
        doc.steps.forEach((s, i) => {
            if (!isObj(s)) {
                errors.push(`steps[${i}] is not an object`);
                return;
            }
            if (s.index !== i)
                errors.push(`steps[${i}].index must equal ${i} (got ${JSON.stringify(s.index)})`);
            if (typeof s.role !== "string")
                errors.push(`steps[${i}].role must be a string`);
            if (s.tool_call !== undefined) {
                const tc = s.tool_call;
                if (!isObj(tc)) {
                    errors.push(`steps[${i}].tool_call is not an object`);
                }
                else {
                    if (typeof tc.name !== "string" || tc.name.length === 0)
                        errors.push(`steps[${i}].tool_call.name must be a non-empty string`);
                    if (!isObj(tc.args))
                        errors.push(`steps[${i}].tool_call.args must be an object`);
                    if (typeof tc.success !== "boolean")
                        errors.push(`steps[${i}].tool_call.success must be a boolean`);
                }
            }
        });
    }
    if (!isObj(doc.outcome) || typeof doc.outcome.status !== "string") {
        errors.push("missing/invalid `outcome.status` (string)");
    }
    else {
        const allowed = ["success", "failure", "partial", "unknown"];
        if (!allowed.includes(doc.outcome.status))
            errors.push(`outcome.status must be one of ${allowed.join("|")}`);
    }
    return { valid: errors.length === 0, errors };
}
/** Throwing variant — returns the doc typed as Trajectory or throws with all errors. */
export function assertValid(doc) {
    const r = validate(doc);
    if (!r.valid)
        throw new Error("OpenTrajectory validation failed:\n  - " + r.errors.join("\n  - "));
    return doc;
}
