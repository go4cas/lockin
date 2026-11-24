// Drives a night against a real server process (B9, TECH-SPEC 13.4): a host,
// a display and team phones over real WebSockets, restartable mid-night.

import type { DisplayView, HostView, ServerMsg, TeamView, View } from "../../src/shared/protocol.ts";
import { connectClient, type TestClient } from "../helpers/client.ts";
import { startProcess, type ServerProcess } from "../helpers/process.ts";

export type Labelled = TestClient & { role: "host" | "display" | "team"; label: string };

export function latest<T extends View>(c: TestClient): T {
  for (let i = c.received.length - 1; i >= 0; i--) {
    const m = c.received[i]!;
    if (m.t === "state") return m.view as T;
  }
  throw new Error("no state yet");
}

/** Waits until the client's newest view passes `pred` (views arrive after the host's ack). */
export async function waitFor<T extends View>(c: TestClient, pred: (v: T) => boolean, what = "view", timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = latest<T>(c);
    if (pred(v)) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; last phase ${v.phase}: ${JSON.stringify(v).slice(0, 400)}`);
    await Bun.sleep(10);
  }
}

export async function ok(c: TestClient, name: string, args: object = {}): Promise<Record<string, unknown>> {
  const ack = await c.cmd(name, args);
  if (!ack.ok) throw new Error(`${name} ${JSON.stringify(args)}: ${JSON.stringify(ack.error)}`);
  return (ack.result ?? {}) as Record<string, unknown>;
}

export async function code(c: TestClient, name: string, args: object = {}): Promise<string> {
  const ack = await c.cmd(name, args);
  return ack.ok ? "ok" : ack.error.code;
}

export interface Phone { name: string; teamId: string; token: string; c: Labelled }

export class Night {
  p!: ServerProcess;
  cookie!: string;
  host!: Labelled;
  display!: Labelled;
  phones: Phone[] = [];
  /** Every client ever opened, for the privacy check. */
  all: Labelled[] = [];
  restarts = 0;

  constructor(readonly dataDir: string, readonly serverOpts: { port?: number; publicUrl?: string } = {}) {}

  async start(): Promise<void> {
    this.p = await startProcess({ dataDir: this.dataDir, ...this.serverOpts });
    this.cookie = await this.p.signIn();
    this.host = await this.client("host", "host");
    this.display = await this.client("display", "display");
  }

  async client(role: "host" | "display" | "team", label: string, token?: string, headers?: Record<string, string>): Promise<Labelled> {
    const c = await connectClient({ wsUrl: this.p.wsUrl }, { role, cookie: role !== "team" ? this.cookie : undefined, origin: this.p.publicUrl, headers }) as Labelled;
    c.role = role;
    c.label = `${label}#${this.restarts}`;
    this.all.push(c);
    await c.hello(token ? { token } : {});
    return c;
  }

  async join(roomCode: string, name: string): Promise<Phone> {
    const c = await this.client("team", name);
    const r = await ok(c, "team.join", { roomCode, name });
    const phone = { name, teamId: r.teamId as string, token: r.token as string, c };
    this.phones.push(phone);
    return phone;
  }

  phone(name: string): Phone {
    return this.phones.find((p) => p.name === name)!;
  }

  hostView(): HostView { return latest<HostView>(this.host); }
  displayView(): DisplayView { return latest<DisplayView>(this.display); }
  teamView(name: string): TeamView { return latest<TeamView>(this.phone(name).c); }

  /** Host command, then wait until the display has caught up with the host's seq. */
  async cmd(name: string, args: object = {}): Promise<Record<string, unknown>> {
    const r = await ok(this.host, name, args);
    await this.synced();
    return r;
  }

  /** Waits until the display and every phone have the host's latest phase. */
  async synced(): Promise<void> {
    const phase = this.hostView().phase;
    await waitFor(this.display, (v) => v.phase === phase, `display in ${phase}`);
    if (phase === "idle") return;   // phones get bye night_closed instead
    for (const p of this.phones) await waitFor(p.c, (v) => v.phase === phase, `${p.name} in ${phase}`);
  }

  /** SIGKILL the server, start a new process on the same data folder, reconnect everyone with their tokens and cookie. */
  async killAndRestart(): Promise<{ downMs: number }> {
    const t0 = Date.now();
    await this.p.kill();
    await Promise.all(this.all.map((c) => c.closed.catch(() => 0)));
    this.restarts++;
    this.p = await startProcess({ dataDir: this.dataDir, ...this.serverOpts });
    // The host session cookie is stored in the database and survives a restart (12.2).
    this.host = await this.client("host", "host");
    this.display = await this.client("display", "display");
    for (const ph of this.phones) {
      ph.c = await this.client("team", ph.name, ph.token);
      const welcome = ph.c.received.find((m): m is Extract<ServerMsg, { t: "welcome" }> => m.t === "welcome")!;
      if (welcome.teamId !== ph.teamId) throw new Error(`${ph.name} did not rebind after restart`);
    }
    return { downMs: Date.now() - t0 };
  }

  async stop(): Promise<void> {
    for (const c of this.all) c.close();
    await this.p?.stop();
  }
}
