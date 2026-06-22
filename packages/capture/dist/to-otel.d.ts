import type { Trajectory } from "./types.js";
/** Convert one OpenTrajectory document into an OTLP/JSON trace export object. */
export declare function toOtel(t: Trajectory): Record<string, unknown>;
