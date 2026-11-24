// A WebSocket test client that speaks the Lock-In protocol (TECH-SPEC 10, 13.1).
//
//   const c = await connectClient(s, { role: "host", cookie });
//   await c.hello();                         // sends hello, waits for welcome + state
//   const ack = await c.cmd("night.open", { quizId: "x" });
//   const state = await c.next("state");
//   c.close();

import type { ClientMsg, CommandName, Role, ServerMsg } from "../../src/shared/protocol.ts";
import { TEST_PUBLIC_URL } from "./server.ts";

type Msg<T extends ServerMsg["t"]> = Extract<ServerMsg, { t: T }>;

export interface TestClient {
  ws: WebSocket;
  /** Every message received so far, in order. */
  received: ServerMsg[];
  send(msg: ClientMsg | Record<string, unknown>): void;
  sendRaw(text: string): void;
  /** Waits for the next message of a type (one not already taken by an earlier next()). */
  next<T extends ServerMsg["t"]>(type: T, timeoutMs?: number): Promise<Msg<T>>;
  /** Sends hello and waits for welcome and the first state. */
  hello(extra?: { token?: string; protocol?: number; role?: Role }): Promise<{ welcome: Msg<"welcome">; state: Msg<"state"> }>;
  /** Sends a command and waits for its ack. */
  cmd(name: CommandName | string, args?: object): Promise<Msg<"ack">>;
  /** Resolves when the socket closes, with the close code. */
  closed: Promise<number>;
  close(): void;
}

export interface ConnectOptions {
  role?: Role;
  cookie?: string;
  origin?: string | null;
  /** Extra upgrade-request headers, e.g. CF-Connecting-IP to act as another client. */
  headers?: Record<string, string>;
}

export async function connectClient(server: { wsUrl: string }, opts: ConnectOptions = {}): Promise<TestClient> {
  const headers: Record<string, string> = {};
  const origin = opts.origin === undefined ? TEST_PUBLIC_URL : opts.origin;
  if (origin !== null) headers.Origin = origin;
  if (opts.cookie) headers.Cookie = opts.cookie;
  Object.assign(headers, opts.headers);
  // Bun's WebSocket accepts headers for the upgrade request.
  const ws = new WebSocket(server.wsUrl, { headers } as unknown as string[]);

  const received: ServerMsg[] = [];
  const queue: ServerMsg[] = [];
  const waiters: { type: string; resolve: (m: ServerMsg) => void }[] = [];
  let closeResolve!: (code: number) => void;
  const closed = new Promise<number>((r) => { closeResolve = r; });

  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMsg;
    received.push(msg);
    const i = waiters.findIndex((w) => w.type === msg.t);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg);
    else queue.push(msg);
  };
  ws.onclose = (e) => closeResolve(e.code);

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("WebSocket failed to open"));
  });

  let nextId = 1;
  const client: TestClient = {
    ws,
    received,
    closed,
    send(msg) { ws.send(JSON.stringify(msg)); },
    sendRaw(text) { ws.send(text); },
    next(type, timeoutMs = 3000) {
      const i = queue.findIndex((m) => m.t === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0] as never);
      return new Promise((resolve, reject) => {
        const w = { type, resolve: resolve as (m: ServerMsg) => void };
        waiters.push(w);
        setTimeout(() => {
          const j = waiters.indexOf(w);
          if (j >= 0) { waiters.splice(j, 1); reject(new Error(`timed out waiting for "${type}"`)); }
        }, timeoutMs);
      });
    },
    async hello(extra = {}) {
      const msg: Record<string, unknown> = { t: "hello", protocol: extra.protocol ?? 1, role: extra.role ?? opts.role ?? "display" };
      if (extra.token) msg.token = extra.token;
      client.send(msg);
      const welcome = await client.next("welcome");
      const state = await client.next("state");
      return { welcome, state };
    },
    async cmd(name, args = {}) {
      const id = nextId++;
      client.send({ t: "cmd", id, name, args });
      for (;;) {
        const ack = await client.next("ack");
        if (ack.id === id) return ack;
      }
    },
    close() { ws.close(); },
  };
  return client;
}
