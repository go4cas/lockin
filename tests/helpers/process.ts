// A real Lock-In server process for the B9 load and end-to-end tests (TECH-SPEC 13.4).
// Unlike tests/helpers/server.ts (in-process), this spawns `bun src/server/main.ts serve`
// or, when LOCKIN_BIN is set, a compiled binary (e.g. LOCKIN_BIN=dist/lockin-linux-x64),
// on real time, so it can be killed with SIGKILL and started again on the same data folder.
//
//   const p = await startProcess({ dataDir });
//   const cookie = await p.signIn();
//   await p.kill();                         // SIGKILL, no clean shutdown
//   const p2 = await startProcess({ dataDir });

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { TEST_PASSWORD, TEST_PUBLIC_URL, cookieFrom } from "./server.ts";

const ROOT = resolve(import.meta.dir, "../..");

export interface ServerProcess {
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  dataDir: string;
  port: number;
  base: string;
  wsUrl: string;
  publicUrl: string;
  /** Everything the process has printed so far (stdout and stderr). */
  log(): string;
  fetch(path: string, init?: RequestInit & { cookie?: string }): Promise<Response>;
  /** Sets the password with the setup code from the log on first run, else logs in. Returns the Cookie value. */
  signIn(password?: string): Promise<string>;
  /** SIGKILL: the process gets no chance to tidy up. */
  kill(): Promise<void>;
  /** SIGTERM and wait. */
  stop(): Promise<void>;
  /** Which command was started: "source" or the binary's path. */
  target: string;
}

export function tempDataDir(prefix = "lockin-e2e-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function binaryFromEnv(): string | null {
  const bin = process.env.LOCKIN_BIN;
  if (!bin) return null;
  return isAbsolute(bin) ? bin : join(ROOT, bin);
}

export async function startProcess(opts: { dataDir?: string; bin?: string | null; port?: number; publicUrl?: string } = {}): Promise<ServerProcess> {
  const dataDir = opts.dataDir ?? tempDataDir();
  const bin = opts.bin === undefined ? binaryFromEnv() : opts.bin;
  const publicUrl = opts.publicUrl ?? TEST_PUBLIC_URL;
  const args = ["serve", "--data", dataDir, "--port", String(opts.port ?? 0), "--bind", "127.0.0.1", "--public-url", publicUrl];
  const cmd = bin ? [bin, ...args] : ["bun", join(ROOT, "src/server/main.ts"), ...args];
  const proc = Bun.spawn(cmd, { cwd: dataDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" });

  let out = "";
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const dec = new TextDecoder();
    const reader = stream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      out += dec.decode(value);
    }
  };
  void pump(proc.stdout).catch(() => {});
  void pump(proc.stderr).catch(() => {});

  const deadline = Date.now() + 20_000;
  let m: RegExpExecArray | null;
  while (!(m = /Listening on 127\.0\.0\.1:(\d+)/.exec(out))) {
    if (proc.exitCode !== null) throw new Error(`server exited (${proc.exitCode}):\n${out}`);
    if (Date.now() > deadline) { proc.kill(); throw new Error(`server did not start:\n${out}`); }
    await Bun.sleep(20);
  }
  const port = Number(m[1]);
  const base = `http://127.0.0.1:${port}`;

  const doFetch: ServerProcess["fetch"] = (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", publicUrl);
    if (init.cookie) headers.set("Cookie", init.cookie);
    return fetch(base + path, { ...init, headers, redirect: "manual" });
  };

  return {
    proc, dataDir, port, base, wsUrl: `ws://127.0.0.1:${port}/ws`, publicUrl, target: bin ?? "source",
    log: () => out,
    fetch: doFetch,
    async signIn(password = TEST_PASSWORD) {
      const status = await (await doFetch("/api/auth/status")).json() as { setupNeeded: boolean };
      const code = /Setup code: ([A-Z0-9]+)/.exec(out)?.[1];
      const res = status.setupNeeded && code
        ? await doFetch("/api/auth/setup", { method: "POST", body: JSON.stringify({ password, setupCode: code }) })
        : await doFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      if (!res.ok) throw new Error(`signIn failed: ${res.status} ${await res.text()}`);
      return cookieFrom(res);
    },
    async kill() {
      proc.kill("SIGKILL");
      await proc.exited;
    },
    async stop() {
      proc.kill("SIGTERM");
      await proc.exited;
    },
  };
}
