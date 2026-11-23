// Starts the real `lockin` entry point as a child process (TECH-SPEC 4.1, B0 Done when).
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

const procs: Subprocess[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const p of procs.splice(0)) { p.kill("SIGTERM"); await p.exited; }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "lockin-cli-"));
  dirs.push(d);
  return d;
}

/** Spawns a command and waits for "Listening on <bind>:<port>" in its output. */
async function startAndWaitForPort(cmd: string[], env: Record<string, string> = {}): Promise<{ port: number; output: () => string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  procs.push(proc);
  let out = "";
  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
    const m = /Listening on [^\s]+:(\d+)/.exec(out);
    if (m) return { port: Number(m[1]), output: () => out };
  }
  throw new Error(`server did not start:\n${out}\n${await new Response(proc.stderr).text()}`);
}

describe("lockin serve", () => {
  test("starts with --public-url, creates the data folder and answers /api/ping", async () => {
    const data = join(tmp(), "data");
    const { port, output } = await startAndWaitForPort(["bun", "src/server/main.ts", "serve", "--public-url", "https://quiz.example.com", "--port", "0", "--data", data]);
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`);
    expect((await res.json()).app).toBe("lockin");
    expect(existsSync(join(data, "lockin.db"))).toBe(true);
    expect(existsSync(join(data, "quizzes"))).toBe(true);
    expect(output()).toContain("Public address: https://quiz.example.com");
    expect(output()).toMatch(/Setup code: [2-9A-Z]{8}/);
  });

  test("takes its settings from the environment", async () => {
    const data = join(tmp(), "data");
    const { port } = await startAndWaitForPort(["bun", "src/server/main.ts"], { LOCKIN_PUBLIC_URL: "https://quiz.example.com", LOCKIN_PORT: "0", LOCKIN_DATA: data });
    expect((await fetch(`http://127.0.0.1:${port}/api/ping`)).status).toBe(200);
  });

  test("refuses to start without a public URL, in plain English", async () => {
    const proc = Bun.spawn(["bun", "src/server/main.ts", "serve", "--data", join(tmp(), "d")], { stdout: "pipe", stderr: "pipe", env: { ...process.env, LOCKIN_PUBLIC_URL: "" } });
    expect(await proc.exited).toBe(2);
    expect(await new Response(proc.stderr).text()).toContain("Lock-In cannot start: No public URL is set");
  });

  test("--version prints the version", async () => {
    const proc = Bun.spawn(["bun", "src/server/main.ts", "--version"], { stdout: "pipe" });
    expect(await proc.exited).toBe(0);
    expect((await new Response(proc.stdout).text()).trim()).toBe((await Bun.file("package.json").json()).version);
  });
});

describe("bun run dev", () => {
  test("starts the server from source with the development public URL", async () => {
    const data = join(tmp(), "data");
    const { port, output } = await startAndWaitForPort(["bun", "run", "dev", "--port", "0", "--data", data]);
    expect((await fetch(`http://127.0.0.1:${port}/api/ping`)).status).toBe(200);
    expect(output()).toContain("Public address: http://localhost:8080");
  });
});
