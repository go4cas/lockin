// B8: `bun run build` produces dist/lockin-linux-x64 with every served file
// embedded; the binary runs from an empty folder (TECH-SPEC 4.6, B8).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMBED_ROOTS, OUTFILE, ROOT, embeddedPaths } from "../../scripts/build.ts";
import { startTestServer, TEST_PUBLIC_URL, type TestServer } from "../helpers/server.ts";
import { MIN_BUN, versionAtLeast } from "../../src/server/runtime.ts";

const canRun = process.platform === "linux" && process.arch === "x64";

/** The /static URL each embedded file is served at, or null if no static route serves it. */
function staticUrl(path: string): string | null {
  if (path.startsWith("public/")) return `/static/${path.slice("public/".length)}`;
  if (path === "assets/tokens.css") return "/static/shared/tokens.css";
  if (path.startsWith("assets/fonts/")) return `/static/fonts/${path.slice("assets/fonts/".length)}`;
  if (path.startsWith("assets/logo/")) return `/static/logo/${path.slice("assets/logo/".length)}`;
  return null;
}

describe("what gets embedded", () => {
  const paths = embeddedPaths();
  test("public/, vendored Arrow, copy, tokens, fonts and logo", () => {
    expect(paths).toContain("public/shared/ws-client.js");
    expect(paths).toContain("public/vendor/arrow/index.mjs");
    expect(paths).toContain("assets/copy.en.json");
    expect(paths).toContain("assets/tokens.css");
    expect(paths.some((p) => /^assets\/fonts\/.+\.woff2$/.test(p))).toBe(true);
    expect(paths.some((p) => /^assets\/fonts\/OFL-.+\.txt$/.test(p))).toBe(true);
    expect(paths.some((p) => p.startsWith("assets/logo/"))).toBe(true);
    expect(EMBED_ROOTS).toEqual(["public", "assets"]);
  });
  test("nothing from docs/ ships, so design notes never change the binary (LI-021)", () => {
    expect(paths.filter((p) => !p.startsWith("public/") && !p.startsWith("assets/"))).toEqual([]);
  });
  test("every bundled font ships with its licence", () => {
    const families = new Set(paths.filter((p) => /^assets\/fonts\/.+\.woff2$/.test(p)).map((p) => p.slice("assets/fonts/".length).replace(/(-\d{3})?\.woff2$/, "")));
    expect(families.size).toBeGreaterThan(0);
    for (const f of families) expect(paths).toContain(`assets/fonts/OFL-${f}.txt`);
  });
  test("no hidden files", () => {
    expect(paths.filter((p) => p.split("/").some((seg) => seg.startsWith(".")))).toEqual([]);
  });
});

describe.skipIf(!canRun)("the compiled binary", () => {
  let dir: string;
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  let base: string;
  let source: TestServer;
  let buildOutput = "";
  let startLog = "";

  beforeAll(async () => {
    const build = Bun.spawn(["bun", "run", "build"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    buildOutput = (await new Response(build.stdout).text()) + (await new Response(build.stderr).text());
    if ((await build.exited) !== 0) throw new Error(`bun run build failed:\n${buildOutput}`);

    // An empty folder, far from the repository: only the binary goes in.
    dir = mkdtempSync(join(tmpdir(), "lockin-binary-"));
    copyFileSync(join(ROOT, OUTFILE), join(dir, "lockin"));
    proc = Bun.spawn([join(dir, "lockin"), "--public-url", TEST_PUBLIC_URL, "--port", "0"], { cwd: dir, stdin: "ignore", stdout: "pipe", stderr: "pipe" });

    // Wait for "Listening on 127.0.0.1:<port>", the last start-up line.
    const reader = proc.stdout.getReader();
    let log = "";
    const deadline = Date.now() + 15000;
    while (!/Listening on 127\.0\.0\.1:(\d+)/.test(log)) {
      if (Date.now() > deadline) throw new Error(`The binary did not start:\n${log}`);
      const { value, done } = await reader.read();
      if (done) throw new Error(`The binary exited:\n${log}${await new Response(proc.stderr).text()}`);
      log += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    startLog = log;
    base = `http://127.0.0.1:${/Listening on 127\.0\.0\.1:(\d+)/.exec(log)![1]}`;
    source = await startTestServer();
  }, 60000);

  afterAll(async () => {
    proc?.kill();
    await proc?.exited;
    await source?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("bun run build writes dist/lockin-linux-x64 and cleans up its generated entry", () => {
    expect(existsSync(join(ROOT, OUTFILE))).toBe(true);
    expect(existsSync(join(ROOT, "src/server/embedded.ts"))).toBe(false);
    expect(buildOutput).toContain(`Built ${OUTFILE} with ${embeddedPaths().length} embedded files.`);
  });

  test("the embedded Bun runtime is at least MIN_BUN (SA-05)", () => {
    const m = /Lock-In \S+ on Bun (\S+)/.exec(startLog);
    expect(m).not.toBeNull();
    expect(versionAtLeast(m![1]!, MIN_BUN)).toBe(true);
  });

  test("starts from an empty folder and makes its data folder there", () => {
    expect(readdirSync(dir).sort()).toEqual(["lockin", "lockin-data"]);
  });

  test("GET /api/ping", async () => {
    const res = await fetch(`${base}/api/ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ app: "lockin", version: source.app.version });
  });

  test("GET /static/shared/ws-client.js", async () => {
    const res = await fetch(`${base}/static/shared/ws-client.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toBe(await Bun.file(join(ROOT, "public/shared/ws-client.js")).text());
  });

  test("GET /display answers as the source does", async () => {
    // /display is B6's page. Until B6 merges the source answers 404 too; once
    // public/display/index.html exists it must be 200 from the binary.
    const [bin, src] = await Promise.all([fetch(`${base}/display`, { redirect: "manual" }), source.fetch("/display")]);
    expect(bin.status).toBe(src.status);
    // The tagline is a random line from the copy pools on every load (B6), so it is left out of the comparison.
    const noTagline = (t: string) => t.replace(/<meta name="lockin-tagline" content="[^"]*">/, "");
    expect(noTagline(await bin.text())).toBe(noTagline(await src.text()));
    if (existsSync(join(ROOT, "public/display/index.html"))) expect(bin.status).toBe(200);
  });

  test("serves every embedded static file byte for byte, with the right type", async () => {
    let checked = 0;
    for (const path of embeddedPaths()) {
      const url = staticUrl(path);
      if (!url) continue;
      const res = await fetch(base + url);
      expect({ url, status: res.status }).toEqual({ url, status: 200 });
      const want = new Uint8Array(await Bun.file(join(ROOT, path)).arrayBuffer());
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(want);
      const src = await source.fetch(url);
      expect(res.headers.get("content-type")).toBe(src.headers.get("content-type"));
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    expect((await fetch(`${base}/static/vendor/arrow/index.mjs`)).headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  test("host console pages come from the binary too", async () => {
    const res = await fetch(`${base}/host/setup`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(await Bun.file(join(ROOT, "public/host/setup.html")).text());
  });

  test("QR codes work from the binary", async () => {
    // The join QR carries the room code, so a visitor with no session or paired display gets nothing (REVIEW finding 4).
    const res = await fetch(`${base}/qr/join.svg`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });
});
