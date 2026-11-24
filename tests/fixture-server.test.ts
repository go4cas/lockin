import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startFixtureServer } from "../scripts/fixture-server.ts";
import { NOW } from "./fixtures/views/_data.ts";
import { connectClient } from "./helpers/client.ts";

let server: Awaited<ReturnType<typeof startFixtureServer>>;
let base: string;
beforeAll(async () => {
  server = await startFixtureServer(0, () => {});
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

describe("scripts/fixture-server.ts", () => {
  test("lists every fixture", async () => {
    const html = await (await fetch(`${base}/fixtures`)).text();
    expect(html).toContain("/display?fixture=display%2Fleaderboard-20");
    expect(html).toContain("/?fixture=team%2Flobby");
    expect(html).toContain("/host/run?fixture=host%2Fmarking");
  });

  test("serves public/ files", async () => {
    const res = await fetch(`${base}/static/shared/ws-client.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("the WebSocket sends the named fixture, with server time starting at the fixture's time", async () => {
    const c = await connectClient({ wsUrl: `ws://127.0.0.1:${server.port}/ws?fixture=display/leaderboard-20` }, { origin: null });
    const { welcome, state } = await c.hello();
    expect(welcome.serverNow - NOW).toBeLessThan(2000);
    expect(state.view.phase).toBe("leaderboard");
    expect((state.view as { standings: { rows: unknown[] } }).standings.rows).toHaveLength(20);
    expect((await c.cmd("lock")).ok).toBe(true);
    c.close();
  });

  test("an unknown fixture is refused", async () => {
    const res = await fetch(`${base}/ws?fixture=display/nope`);
    expect(res.status).toBe(404);
  });
});
