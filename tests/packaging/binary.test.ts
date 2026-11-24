// B8: `bun run build` produces dist/lockin-linux-x64 with every served file
// embedded; the binary runs from an empty folder (TECH-SPEC 4.6, B8).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMBED_ROOTS, OUTFILE, ROOT, embeddedPaths } from "../../scripts/build.ts";
import { startTestServer, TEST_PUBLIC_URL, type TestServer } from "../helpers/server.ts";

const canRun = process.platform === "linux" && process.arch === "x64";

/** The /static URL each embedded file is served at, or null if no static route serves it. */
function staticUrl(path: string): string | null {
  if (path.startsWith("public/")) return `/static/${path.slice("public/".length)}`;
  if (path === "docs/design/tokens.css") return "/static/shared/tokens.css";
  if (path.startsWith("docs/design/fonts/")) return `/static/fonts/${path.slice("docs/design/fonts/".length)}`;
  if (path.startsWith("docs/design/logo/")) return `/static/logo/${path.slice("docs/design/logo/".length)}`;
  return null;
}

describe("what gets embedded", () => {
  const paths = embeddedPaths();
  test("public/, vendored Arrow, copy, tokens, fonts and logo", () => {
    expect(paths).toContain("public/shared/ws-client.js");
    expect(paths).toContain("public/vendor/arrow/index.mjs");
    expect(paths).toContain("docs/brand/copy.en.json");
    expect(paths).toContain("docs/design/tokens.css");
    expect(paths.some((p) => /^docs\/design\/fonts\/.+\.woff2$/.test(p))).toBe(true);
    expect(paths.some((p) => /^docs\/design\/fonts\/OFL-.+\.txt$/.test(p))).toBe(true);
    expect(paths.some((p) => p.startsWith("docs/design/logo/"))).toBe(true);
    expect(EMBED_ROOTS).toHaveLength(5);
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
    expect(await bin.text()).toBe(await src.text());
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
    const res = await fetch(`${base}/qr/join.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
  });
});
