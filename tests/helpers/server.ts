// An in-process Lock-In server on a random port with a temporary data folder
// (TECH-SPEC 13.1). Every module's tests can use it.
//
//   const s = await startTestServer();
//   const res = await s.fetch("/api/ping");
//   const cookie = await s.signIn();          // sets a password and returns the host cookie
//   await s.stop();

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "../../src/server/app.ts";
import type { Clock, PasswordHasher } from "../../src/server/auth.ts";
import type { Config } from "../../src/server/config.ts";
import type { ServiceOverrides } from "../../src/server/services.ts";

/** The public URL every test server uses; send it as Origin on mutating requests. */
export const TEST_PUBLIC_URL = "http://localhost:8080";
export const TEST_PASSWORD = "correct horse battery";

export interface TestServer extends RunningServer {
  dataDir: string;
  /** Base URL to reach the server, e.g. "http://127.0.0.1:41234". */
  base: string;
  wsUrl: string;
  /** fetch() against the server. Adds `Origin: <publicUrl>` unless `origin: null` is given. */
  fetch(path: string, init?: RequestInit & { origin?: string | null; cookie?: string }): Promise<Response>;
  /** Sets the host password (if needed) and signs in; returns the Cookie header value. */
  signIn(password?: string): Promise<string>;
  logs: string[];
}

export interface TestServerOptions {
  dataDir?: string;
  config?: Partial<Config>;
  clock?: Clock;
  keepData?: boolean;
  /** Password hashing stand-in (SA-08 tests count what runs at once). */
  hasher?: PasswordHasher;
  /** Fake rules and copy picker, fixed when the app is built (LI-020). */
  services?: ServiceOverrides;
}

export async function startTestServer(opts: TestServerOptions = {}): Promise<TestServer> {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), "lockin-test-"));
  const logs: string[] = [];
  const config: Config = { dataDir, port: 0, bind: "127.0.0.1", publicUrl: TEST_PUBLIC_URL, ...opts.config };
  const running = await startServer(config, { log: (m) => logs.push(m), clock: opts.clock, hasher: opts.hasher, services: opts.services });
  const base = `http://127.0.0.1:${running.port}`;

  const doFetch: TestServer["fetch"] = (path, init = {}) => {
    const headers = new Headers(init.headers);
    const origin = init.origin === undefined ? TEST_PUBLIC_URL : init.origin;
    if (origin !== null) headers.set("Origin", origin);
    if (init.cookie) headers.set("Cookie", init.cookie);
    return fetch(base + path, { ...init, headers, redirect: "manual" });
  };

  const server: TestServer = {
    ...running,
    dataDir,
    base,
    wsUrl: `ws://127.0.0.1:${running.port}/ws`,
    logs,
    fetch: doFetch,
    async signIn(password = TEST_PASSWORD) {
      let res: Response;
      if (running.app.auth.setupNeeded()) {
        const setupCode = running.app.auth.ensureSetupCode();
        res = await doFetch("/api/auth/setup", { method: "POST", body: JSON.stringify({ password, setupCode }) });
      } else {
        res = await doFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      }
      if (!res.ok) throw new Error(`signIn failed: ${res.status} ${await res.text()}`);
      return cookieFrom(res);
    },
    async stop() {
      await running.stop();
      if (!opts.keepData && !opts.dataDir) rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return server;
}

/** "name=value" of the first Set-Cookie on a response. */
export function cookieFrom(res: Response): string {
  const set = res.headers.get("set-cookie");
  if (!set) throw new Error("no Set-Cookie on response");
  return set.split(";")[0]!;
}
