// B0 contract fix made in the B3 PR: pages import Arrow from "/vendor/arrow/index.mjs"
// (TECH-SPEC 3.4), so the server and the fixture server must serve /vendor/*.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startFixtureServer } from "../../scripts/fixture-server.ts";
import { vendorPath } from "../../src/server/static.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";

let s: TestServer;
let fixtures: Awaited<ReturnType<typeof startFixtureServer>>;
beforeAll(async () => {
  s = await startTestServer();
  fixtures = await startFixtureServer(0, () => {});
});
afterAll(async () => {
  await s.stop();
  fixtures.stop(true);
});

describe("GET /vendor/*", () => {
  test("maps only to files inside public/vendor/", () => {
    expect(vendorPath("arrow/index.mjs")).toBe("public/vendor/arrow/index.mjs");
    expect(vendorPath("../host/nav.js")).toBeNull();
    expect(vendorPath("arrow/.hidden")).toBeNull();
    expect(vendorPath("")).toBeNull();
  });

  test("the server serves Arrow and its chunk as JavaScript, without a session", async () => {
    const res = await s.fetch("/vendor/arrow/index.mjs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/javascript");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await res.text();
    const chunk = /from '\.\/(chunks\/[^']+\.mjs)'/.exec(body) ?? /from "\.\/(chunks\/[^"]+\.mjs)"/.exec(body);
    expect(chunk).not.toBeNull();
    expect((await s.fetch(`/vendor/arrow/${chunk![1]}`)).status).toBe(200);
  });

  test("the server refuses paths that leave the folder and missing files", async () => {
    expect((await s.fetch("/vendor/arrow/nope.mjs")).status).toBe(404);
    expect((await s.fetch("/vendor/%2e%2e/host/nav.js")).status).toBe(404);
  });

  test("the fixture server serves it too", async () => {
    const res = await fetch(`http://127.0.0.1:${fixtures.port}/vendor/arrow/index.mjs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/javascript");
  });
});
