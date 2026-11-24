// The production app keeps the default venue name in every view (code review LI-023).
import { afterEach, describe, expect, test } from "bun:test";
import type { ServerMsg } from "../../src/shared/protocol.ts";
import { connectClient, type TestClient } from "../helpers/client.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";
import { makeQuiz, q, text, writeQuiz } from "../night/fakes.ts";

const open: TestClient[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  while (open.length) open.pop()!.close();
  while (servers.length) await servers.pop()!.stop();
});

async function client(s: TestServer, role: "host" | "display" | "team", cookie?: string) {
  const c = await connectClient(s, { role, cookie });
  open.push(c);
  await c.hello({});
  return c;
}
function view(c: TestClient): any {
  const states = c.received.filter((m): m is Extract<ServerMsg, { t: "state" }> => m.t === "state");
  return states[states.length - 1]!.view;
}

describe("venue name in production views (LI-023)", () => {
  test("no theme: host, display and team views say Lock-In", async () => {
    const s = await startTestServer();
    servers.push(s);
    const quiz = makeQuiz("venue-default", [[q(text("x"))]]);
    writeQuiz(s.dataDir, quiz);
    const cookie = await s.signIn();
    const host = await client(s, "host", cookie);
    const display = await client(s, "display", cookie);
    expect(view(host).venue.name).toBe("Lock-In");
    const opened = await host.cmd("night.open", { quizId: quiz.id });
    expect(opened.ok).toBe(true);
    const phone = await client(s, "team");
    const joined = await phone.cmd("team.join", { roomCode: (opened as any).result.roomCode, name: "Quiz Team" });
    expect(joined.ok).toBe(true);
    await Bun.sleep(150);
    for (const c of [host, display, phone]) expect(view(c).venue.name).toBe("Lock-In");
  });

  test("a custom venue name appears in every view", async () => {
    const s = await startTestServer();
    servers.push(s);
    const cookie = await s.signIn();
    const put = await s.fetch("/api/theme", { method: "PUT", cookie, body: JSON.stringify({ theme: { format: "lockin.theme/1", name: "The Hanks" } }), headers: { "content-type": "application/json" } });
    expect(put.status).toBe(200);
    const host = await client(s, "host", cookie);
    const display = await client(s, "display", cookie);
    for (const c of [host, display]) expect(view(c).venue.name).toBe("The Hanks");
  });
});
