// Dead-connection detection and command deadlines in ws-client.js (code review LI-001).
// Runs the real client against fake sockets and a virtual clock, so 2 minutes take no time.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadBrowserScripts, type BrowserClient, type LockInGlobal } from "../helpers/browser-scripts.ts";

let LockIn: LockInGlobal;
beforeAll(() => {
  LockIn = loadBrowserScripts("public/shared/clock.js", "public/shared/ws-client.js");
});

/** A virtual clock with setTimeout/clearTimeout. advance() runs due timers in order. */
class VirtualTimers {
  t = 1_000_000;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.seq; this.timers.set(id, { at: this.t + ms, fn }); return id; };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  /** Moves time on, firing timers as they fall due. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
  /** Jumps time without running timers, like a phone asleep, then runs what is due. */
  sleep(ms: number) {
    const due = [...this.timers.entries()];
    this.t += ms;
    for (const [id, tm] of due) if (this.timers.has(id)) { tm.at = Math.max(tm.at, this.t); }
    this.advance(0);
  }
  get count() { return this.timers.size; }
}

interface FakeSocket {
  readyState: number; sent: any[]; closed: boolean; silent: boolean;
  onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void; onerror?: () => void;
  send(s: string): void; close(): void;
  deliver(msg: unknown): void;
}

/**
 * A server stand-in: answers hello with welcome + state, ping with pong, and commands with acks,
 * until it is told to go silent (the network drops everything, the socket stays OPEN).
 */
function fakeServer(timers: VirtualTimers, opts: { ackCommands?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const applied: { id: number; name: string }[] = [];
  const net = { down: false };   // the whole network drops everything
  let seq = 0;
  const create = () => {
    const s: FakeSocket = {
      readyState: 0, sent: [], closed: false, silent: false,
      send(raw: string) {
        const msg = JSON.parse(raw);
        s.sent.push(msg);
        if (s.silent || net.down) return;
        if (msg.t === "hello") { s.deliver({ t: "welcome", protocol: 1, role: msg.role, serverNow: timers.now(), teamId: null }); s.deliver({ t: "state", seq: ++seq, serverNow: timers.now(), view: { phase: "lobby", n: applied.length } }); }
        if (msg.t === "ping") s.deliver({ t: "pong", c: msg.c, s: timers.now() });
        if (msg.t === "cmd") { applied.push({ id: msg.id, name: msg.name }); if (opts.ackCommands !== false) s.deliver({ t: "ack", id: msg.id, ok: true, result: { n: applied.length } }); }
      },
      close() { s.closed = true; s.readyState = 3; },
      deliver(msg: unknown) { if (!s.closed) s.onmessage?.({ data: JSON.stringify(msg) }); },
    };
    sockets.push(s);
    timers.setTimeout(() => { if (!s.closed) { s.readyState = 1; s.onopen?.(); } }, 50);
    return s;
  };
  return { sockets, applied, create, net, get current() { return sockets[sockets.length - 1]!; } };
}

function start(opts: { ackCommands?: boolean } = {}) {
  const timers = new VirtualTimers();
  const server = fakeServer(timers, opts);
  const statuses: string[] = [];
  const views: any[] = [];
  const c = LockIn.connect({
    role: "host", url: "ws://unused", createSocket: server.create, random: () => 0,
    timers, onStatus: (st: string) => statuses.push(st), onState: (v: unknown) => views.push(v),
  }) as BrowserClient & { welcomed: boolean };
  timers.advance(100);
  return { timers, server, c, statuses, views };
}

describe("ws-client.js deadlines (LI-001)", () => {
  test("an OPEN socket that goes silent is abandoned, shown offline and replaced", () => {
    const { timers, server, c, statuses } = start();
    expect(c.status).toBe("online");
    server.net.down = true;     // network gone; the browser never fires close
    timers.advance(60_000);
    expect(server.sockets[0]!.closed).toBe(true);
    expect(statuses).toContain("offline");
    // The network comes back: the next attempt reconnects and gets the state.
    server.net.down = false;
    timers.advance(10_000);
    expect(c.status).toBe("online");
    expect(server.sockets.length).toBeGreaterThan(1);
  });

  test("silence is detected within the documented bound (35 s of no messages plus one 5 s check)", () => {
    const { timers, server } = start();
    timers.advance(30_000);           // past the fast-ping phase
    server.current.silent = true;
    timers.advance(40_000);
    expect(server.sockets[0]!.closed).toBe(true);
  });

  test("a long idle period with pongs flowing keeps the connection", () => {
    const { timers, server, c, statuses } = start();
    timers.advance(30 * 60_000);
    expect(server.sockets).toHaveLength(1);
    expect(c.status).toBe("online");
    expect(statuses).toEqual(["online"]);
  });

  test("a missing welcome abandons the socket and tries again", () => {
    const timers = new VirtualTimers();
    const server = fakeServer(timers);
    const c = LockIn.connect({ role: "display", url: "ws://unused", createSocket: () => { const s = server.create(); if (server.sockets.length === 1) s.silent = true; return s; }, random: () => 0, timers });
    timers.advance(20_000);
    expect(server.sockets[0]!.closed).toBe(true);
    expect(c.status).toBe("online");
    c.close();
  });

  test("a command with no ack settles as timeout, frees the caller and reconnects; nothing is replayed", async () => {
    const { timers, server, c } = start({ ackCommands: false });
    let settled: unknown = null;
    c.cmd("timer.start").then((r) => { settled = { ok: r }; }, (e) => { settled = e; });
    timers.advance(10_000);
    await Promise.resolve();
    expect(settled).toMatchObject({ code: "timeout" });
    expect(server.sockets[0]!.closed).toBe(true);
    timers.advance(5_000);
    expect(c.status).toBe("online");
    // The server applied it once (the ack was lost); the client did not send it again.
    expect(server.applied).toEqual([{ id: 1, name: "timer.start" }]);
    expect(server.sockets.slice(1).flatMap((s) => s.sent).filter((m) => m.t === "cmd")).toEqual([]);
  });

  test("a late ack cannot settle a later command", async () => {
    const { timers, server, c } = start({ ackCommands: false });
    const first = c.cmd("lock").catch((e) => e);
    timers.advance(10_000);
    expect(await first).toMatchObject({ code: "timeout" });
    timers.advance(5_000);   // reconnected
    let second: unknown = "pending";
    c.cmd("lock").then((r) => { second = r; }, (e) => { second = e; });
    server.current.deliver({ t: "ack", id: 1, ok: true, result: "late" });   // the first command's lost ack
    await Promise.resolve();
    expect(second).toBe("pending");
    server.current.deliver({ t: "ack", id: 2, ok: true, result: "mine" });
    await Promise.resolve();
    expect(second).toBe("mine");
  });

  test("a dropped socket settles pending commands and clears their timers", async () => {
    const { timers, server, c } = start({ ackCommands: false });
    const p = c.cmd("lock").catch((e) => e);
    server.current.onclose?.();
    expect(await p).toMatchObject({ code: "disconnected" });
    timers.advance(5_000);
    expect(server.sockets.length).toBe(2);
    expect(c.status).toBe("online");    // no stray timeout later abandons the new socket
    timers.advance(60_000);
    expect(server.sockets.length).toBe(2);
  });

  test("a phone waking from a long sleep probes before giving up, and keeps a healthy socket", () => {
    const { timers, server, c } = start();
    timers.advance(30_000);
    timers.sleep(10 * 60_000);          // timers frozen for 10 minutes, then the page wakes
    timers.advance(15_000);
    expect(server.sockets).toHaveLength(1);
    expect(c.status).toBe("online");
  });

  test("a phone waking on a dead network reconnects within the probe window", () => {
    const { timers, server, c } = start();
    timers.advance(30_000);
    server.current.silent = true;
    timers.sleep(10 * 60_000);
    timers.advance(15_000);
    expect(server.sockets[0]!.closed).toBe(true);
    c.close();
  });

  test("close() leaves no timers behind", () => {
    const { timers, c } = start();
    c.close();
    expect(timers.count).toBe(0);
  });
});
