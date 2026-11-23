// Loads the browser's classic scripts (public/shared/*.js) into this process,
// the way a page's <script> tags would, so they can be tested against a real server.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export interface LockInGlobal {
  Clock: new () => {
    sample(c: number, s: number, now?: number): number; seed(serverNow: number): void;
    offset(): number; now(): number; remaining(t: number): number;
  };
  createClock(): InstanceType<LockInGlobal["Clock"]>;
  backoff(attempt: number, random?: () => number): number;
  connect(opts: Record<string, unknown>): BrowserClient;
  view: {
    countdown(ms: number, short?: boolean): string;
    joinNames(names: string[]): string;
    teamColour(i: number): string;
  };
}

export interface BrowserClient {
  status: string;
  view: any;
  teamId: string | null;
  lastSeq: number;
  clock: InstanceType<LockInGlobal["Clock"]>;
  stopped: boolean;
  cmd(name: string, args?: object): Promise<unknown>;
  receive(msg: unknown): void;
  close(): void;
  reconnect(): void;
}

/** Runs the scripts in order (like <script> tags) and returns window.LockIn. */
export function loadBrowserScripts(...files: string[]): LockInGlobal {
  for (const f of files) {
    const code = readFileSync(join(ROOT, f), "utf8");
    // Classic script semantics: not a module, `this` is the global object.
    new Function(code).call(globalThis);
  }
  return (globalThis as unknown as { LockIn: LockInGlobal }).LockIn;
}
