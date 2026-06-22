// Minimal ambient declarations for the Node built-ins this SDK uses.
// Vendored so the package type-checks with ZERO external deps (no @types/node)
// on an airlocked machine. Covers only the surface we touch.

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function appendFileSync(path: string, data: string): void;
}

declare module "node:path" {
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}

declare namespace NodeJS {
  interface ReadStream {
    setEncoding(enc: string): void;
    on(event: "data", cb: (chunk: string) => void): void;
    on(event: "end", cb: () => void): void;
  }
}

declare const process: {
  argv: string[];
  stdin: NodeJS.ReadStream;
  stdout: { write(s: string): void };
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

interface ImportMeta {
  url: string;
}
