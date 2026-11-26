import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HELLO_TIMEOUT_MS, idleView as idle } from "../../src/server/ws.ts";
import { connectClient, type TestClient } from "../helpers/client.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";

let s: TestServer;
let cookie: string;
const open: TestClient[] = [];
async function client(opts: Parameters<typeof connectClient>[1] = {}) {
  const c = await connectClient(s, opts);
  open.push(c);
  return c;
}
beforeAll(async () => {
  s = await startTestServer();
  cookie = await s.signIn();
});
afterAll(async () => {
  for (const c of open) c.close();
  await s.stop();
});

describe("hello (TECH-SPEC 10.2)", () => {
  test("display, team and host each get welcome then state", async () => {
    for (const role of ["display", "team", "host"] as const) {
      const c = await client({ role, cookie: role === "host" ? cookie : undefined });
      const before = Date.now();
      const { welcome, state } = await c.hello();
      expect(welcome).toMatchObject({ t: "welcome", protocol: 1, role, teamId: null });
      expect(Math.abs(welcome.serverNow - before)).toBeLessThan(5000);
      expect(state.view.role).toBe(role);
      expect(state.view.phase).toBe("idle");
      expect(c.received.map((m) => m.t)).toEqual(["welcome", "state"]);
    }
  });

  test("a host hello without a session gets bye signed_out and is closed", async () => {
    const c = await client({ role: "host" });
    c.send({ t: "hello", protocol: 1, role: "host" });
    expect(await c.next("bye")).toEqual({ t: "bye", reason: "signed_out" });
    expect(await c.closed).toBe(1000);
  });

  test("an unknown protocol version is closed", async () => {
    const c = await client();
    c.send({ t: "hello", protocol: 2, role: "display" });
    expect((await c.next("bye")).reason).toBe("protocol");
    await c.closed;
  });

  test("bad JSON, a command before hello, or a second hello are protocol errors", async () => {
    const a = await client();
    a.sendRaw("{not json");
    expect((await a.next("bye")).reason).toBe("protocol");
    const b = await client();
    b.send({ t: "cmd", id: 1, name: "lock", args: {} });
    expect((await b.next("bye")).reason).toBe("protocol");
    const c = await client();
    await c.hello();
    c.send({ t: "hello", protocol: 1, role: "display" });
    expect((await c.next("bye")).reason).toBe("protocol");
  });

  test("a connection with no hello within 5 s is closed", async () => {
    const c = await client();
    const started = Date.now();
    const bye = await c.next("bye", HELLO_TIMEOUT_MS + 2000);
    expect(bye.reason).toBe("protocol");
    await c.closed;
    expect(Date.now() - started).toBeGreaterThanOrEqual(HELLO_TIMEOUT_MS - 100);
  }, 10_000);

  test("the upgrade needs an Origin equal to the public URL", async () => {
    await expect(connectClient(s, { origin: "https://evil.example.com" })).rejects.toThrow();
    await expect(connectClient(s, { origin: null })).rejects.toThrow();
  });
});

describe("ping and pong (TECH-SPEC 10.6)", () => {
  test("pong echoes the client time and adds server time", async () => {
    const c = await client();
    await c.hello();
    c.send({ t: "ping", c: 12345 });
    const pong = await c.next("pong");
    expect(pong.c).toBe(12345);
    expect(Math.abs(pong.s - Date.now())).toBeLessThan(5000);
  });

  test("ping works before hello too", async () => {
    const c = await client();
    c.send({ t: "ping", c: 1 });
    expect((await c.next("pong")).c).toBe(1);
  });
});

describe("commands (TECH-SPEC 10.5)", () => {
  test("with no night open, commands that need one answer wrong_phase (B1 engine)", async () => {
    const host = await client({ role: "host", cookie });
    await host.hello();
    const ack = await host.cmd("lock");
    expect(!ack.ok && ack.error.code).toBe("wrong_phase");
    expect(!(await host.cmd("night.open", { quizId: "x" })).ok).toBe(true);
    const team = await client({ role: "team" });
    await team.hello();
    expect((await team.cmd("team.join", { roomCode: "BCDF", name: "Quizteama Aguilera" })).ok).toBe(false);
  });

  test("roles are enforced before the handler runs", async () => {
    const display = await client();
    await display.hello();
    const a = await display.cmd("lock");
    expect(!a.ok && a.error.code).toBe("not_allowed");
    const team = await client({ role: "team" });
    await team.hello();
    const b = await team.cmd("quiz.start");
    expect(!b.ok && b.error.code).toBe("not_allowed");
    const host = await client({ role: "host", cookie });
    await host.hello();
    const c = await host.cmd("answer.submit", { questionId: "q-1", value: { type: "number", value: 1 } });
    expect(!c.ok && c.error.code).toBe("not_allowed");
  });

  test("unknown commands and bad args are bad_args", async () => {
    const host = await client({ role: "host", cookie });
    await host.hello();
    const a = await host.cmd("night.explode");
    expect(!a.ok && a.error.code).toBe("bad_args");
    host.send({ t: "cmd", id: 99, name: "lock", args: [1] });
    const b = await host.next("ack");
    expect(b.id === 99 && !b.ok && b.error.code).toBe("bad_args");
  });

  test("a registered handler gets the command, the connection and the args; its result is the ack", async () => {
    const seen: unknown[] = [];
    s.app.ws.setCommandHandler((conn, name, args) => {
      seen.push([conn.role, name, args]);
      if (name === "team.join") conn.bindTeam("t-abcdefgh");
      return { ok: true, result: { echoed: name } };
    });
    try {
      const team = await client({ role: "team" });
      await team.hello();
      const ack = await team.cmd("team.join", { roomCode: "BCDF", name: "Les Quizerables" });
      expect(ack).toEqual({ t: "ack", id: 1, ok: true, result: { echoed: "team.join" } });
      expect(seen).toEqual([["team", "team.join", { roomCode: "BCDF", name: "Les Quizerables" }]]);
      expect(s.app.ws.connections("team").some((c) => c.teamId === "t-abcdefgh")).toBe(true);
    } finally {
      s.app.ws.setCommandHandler(() => ({ ok: false, error: { code: "wrong_phase", message: "No night is running yet." } }));
    }
  });

  test("a handler that throws gives server_error, not a dead socket", async () => {
    s.app.ws.setCommandHandler(() => { throw new Error("boom"); });
    try {
      const host = await client({ role: "host", cookie });
      await host.hello();
      const ack = await host.cmd("lock");
      expect(!ack.ok && ack.error.code).toBe("server_error");
      host.send({ t: "ping", c: 5 });
      expect((await host.next("pong")).c).toBe(5);
    } finally {
      s.app.ws.setCommandHandler(() => ({ ok: false, error: { code: "wrong_phase", message: "No night is running yet." } }));
    }
  });
});

describe("plug-in points for the engine", () => {
  test("a team token is resolved at hello and the view provider and broadcast are used", async () => {
    s.app.ws.setTeamTokenResolver((token) => (token === "good-token" ? "t-team0001" : null));
    let seq = 7;
    s.app.ws.setViewProvider((conn) => ({
      seq,
      view: { ...(JSON.parse(JSON.stringify(idle(conn.role!)))), venue: { name: `for ${conn.teamId ?? conn.role}`, themeVersion: "v", teamColours: 8, countdown: "ring" } },
    }));
    try {
      const team = await client({ role: "team" });
      const { welcome, state } = await team.hello({ token: "good-token" });
      expect(welcome.teamId).toBe("t-team0001");
      expect(state.seq).toBe(7);
      expect(state.view.venue.name).toBe("for t-team0001");
      const stranger = await client({ role: "team" });
      expect((await stranger.hello({ token: "bad-token" })).welcome.teamId).toBeNull();

      seq = 8;
      s.app.ws.broadcastState((c) => c.teamId === "t-team0001");
      expect((await team.next("state")).seq).toBe(8);
    } finally {
      s.app.ws.setTeamTokenResolver(() => null);
      s.app.ws.setViewProvider((conn) => ({ seq: 0, view: idle(conn.role ?? "display") }));
    }
  });

  test("connect and disconnect listeners fire", async () => {
    const events: string[] = [];
    s.app.ws.onConnect((c) => events.push(`in:${c.role}`));
    s.app.ws.onDisconnect((c) => events.push(`out:${c.role}`));
    const display = await client();
    await display.hello();
    display.close();
    await display.closed;
    await Bun.sleep(50);
    expect(events).toEqual(["in:display", "out:display"]);
  });
});

describe("signing out", () => {
  test("logout closes that session's host sockets with bye signed_out", async () => {
    const own = await s.signIn();
    const host = await client({ role: "host", cookie: own });
    await host.hello();
    const other = await client({ role: "host", cookie });
    await other.hello();
    await s.fetch("/api/auth/logout", { method: "POST", cookie: own });
    expect((await host.next("bye")).reason).toBe("signed_out");
    other.send({ t: "ping", c: 3 });
    expect((await other.next("pong")).c).toBe(3);
  });
});
