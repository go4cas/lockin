// WebSocket hub: hello, roles, ping/pong, command routing (TECH-SPEC section 10).
// The night engine (B1) plugs in through setCommandHandler, setViewProvider and
// setTeamTokenResolver; until then a stub answers `wrong_phase` and every
// client gets an idle view.

import type { Server, ServerWebSocket } from "bun";
import {
  COMMAND_NAMES, PROTOCOL, TEAM_COMMANDS, emptyLines,
  type ClientMsg, type CommandName, type ErrorCode, type HostView, type Role, type ServerMsg, type TeamView, type DisplayView, type View,
} from "../shared/protocol.ts";
import type { Clock } from "./auth.ts";

export const HELLO_TIMEOUT_MS = 5_000;
export const IDLE_TIMEOUT_S = 60;
/** Largest client frame (SA-04): the biggest real one, night.open with 30 long prizes, is about 11 KB. */
export const MAX_MESSAGE_BYTES = 32 * 1024;
/** A socket that has this much unsent data queued (it is not reading) is closed (SA-04). */
export const BACKPRESSURE_LIMIT = 1024 * 1024;
/**
 * Open sockets (SA-04): in total, and per client IP. A full pub on one Wi-Fi address is
 * 30 phones, a few displays and a console, with room for every phone reconnecting at once.
 */
export const MAX_SOCKETS = 600;
export const MAX_SOCKETS_PER_IP = 120;
/** Messages per socket (SA-04), pings included: a burst of 20, then 10 a second. Hosts are trusted and not limited. */
export const MESSAGE_BURST = 20;
export const MESSAGES_PER_SECOND = 10;
/** Host-only updates (presence, display counts) are sent at most this often (SA-04, SA-03). */
export const HOST_UPDATE_MS = 250;

export type ByeReason = Extract<ServerMsg, { t: "bye" }>["reason"];
export type CommandResult = { ok: true; result?: unknown } | { ok: false; error: { code: ErrorCode; message: string } };

/** Data Bun keeps on each socket. */
export interface SocketData {
  connId: number;
  ip: string;
  /** Hash of the host session cookie sent on the upgrade request, if it was valid. */
  hostSession: string | null;
  /** True while this socket holds a place under the socket caps (SA-04). */
  admitted?: boolean;
}

export interface Conn {
  readonly id: number;
  readonly ip: string;
  /** Null until `hello`. */
  readonly role: Role | null;
  /** The team this connection is bound to (team role only). */
  readonly teamId: string | null;
  readonly hostSession: string | null;
  /** Display role: true once paired (token or host session). Always true without a display authoriser. */
  readonly paired: boolean;
  readonly connectedAt: number;
  lastMessageAt: number;
  send(msg: ServerMsg): void;
  /** Binds or unbinds the team on this connection (B1: after team.join / team.rejoin). */
  bindTeam(teamId: string | null): void;
  /** Sends `bye` and closes the connection. */
  bye(reason: ByeReason): void;
  /** Marks a display paired or not; with a token, sends it `paired` so it keeps the token. */
  setPaired(paired: boolean, token?: string): void;
}

export type CommandHandler = (conn: Conn, name: CommandName, args: Record<string, unknown>) => CommandResult | Promise<CommandResult>;
export type ViewProvider = (conn: Conn) => { seq: number; view: View };
export type TeamTokenResolver = (token: string) => string | null;
/** Decides at hello whether a display connection is paired (it may call conn.setPaired with a new token). */
export type DisplayAuthoriser = (conn: Conn, token: string | null) => void;

export const MESSAGES: Partial<Record<ErrorCode, string>> = {
  not_allowed: "This screen cannot do that.",
  wrong_phase: "That can't be done right now.",
  bad_args: "That request was not understood.",
  server_error: "Something went wrong on the server. Try again.",
};

export function fail(code: ErrorCode, message?: string): CommandResult {
  return { ok: false, error: { code, message: message ?? MESSAGES[code] ?? "That can't be done right now." } };
}

/** The view every role sees while no night is open, before the engine (B1) provides real views. */
export function idleView(role: Role, venueName = "Lock-In"): View {
  const common = { phase: "idle" as const, venue: { name: venueName, themeVersion: "default", teamColours: 8 }, night: null, flash: null };
  if (role === "display") {
    return { ...common, role: "display", teams: [], question: null, lockedMoment: null, reveal: null, standings: null, suddenDeath: null, final: null, lines: emptyLines() } satisfies DisplayView;
  }
  if (role === "team") {
    return { ...common, role: "team", self: null, teams: [], questions: [], answers: [], standings: null, suddenDeath: null, lines: emptyLines() } satisfies TeamView;
  }
  return {
    ...common, role: "host", teams: [], round: null, current: null, marking: null, reveal: null, standings: null,
    suddenDeath: null, suddenDeathNeeded: null, finalStandingsAt: null, can: {}, lines: emptyLines(),
  } satisfies HostView;
}

class Connection implements Conn {
  role: Role | null = null;
  teamId: string | null = null;
  paired = true;
  lastMessageAt: number;
  readonly connectedAt: number;
  helloTimer: ReturnType<typeof setTimeout> | null = null;
  closed = false;
  /** Message budget (SA-04): tokens left and when they were last topped up (real time, ms). */
  tokens = MESSAGE_BURST;
  tokensAt = performance.now();

  constructor(readonly ws: ServerWebSocket<SocketData>, private clock: Clock) {
    this.connectedAt = clock.now();
    this.lastMessageAt = this.connectedAt;
  }
  get id() { return this.ws.data.connId; }
  get ip() { return this.ws.data.ip; }
  get hostSession() { return this.ws.data.hostSession; }

  send(msg: ServerMsg): void {
    // Bun closes the socket itself once BACKPRESSURE_LIMIT is queued (closeOnBackpressureLimit).
    if (!this.closed) this.ws.send(JSON.stringify(msg));
  }
  /** Takes one message from the budget; false when the socket is over it (SA-04). */
  spend(): boolean {
    if (this.role === "host") return true;
    const now = performance.now();
    this.tokens = Math.min(MESSAGE_BURST, this.tokens + ((now - this.tokensAt) / 1000) * MESSAGES_PER_SECOND);
    this.tokensAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  bindTeam(teamId: string | null): void {
    this.teamId = teamId;
  }
  setPaired(paired: boolean, token?: string): void {
    this.paired = paired;
    if (token) this.send({ t: "paired", token });
  }
  bye(reason: ByeReason): void {
    if (this.closed) return;
    this.send({ t: "bye", reason });
    this.closed = true;
    this.ws.close(1000, reason);
  }
}

export interface HubOptions {
  clock: Clock;
  /** True if the host session (by hash) is still valid. */
  sessionAlive: (hash: string) => boolean;
  log?: (msg: string) => void;
}

export class Hub {
  private conns = new Map<number, Connection>();
  private nextId = 1;
  /** Sockets admitted (upgrade accepted, not yet closed), in total and by client IP (SA-04). */
  private socketCount = 0;
  private socketsByIp = new Map<string, number>();
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private hostPending = false;
  private hostLastAt = -Infinity;
  private commandHandler: CommandHandler = () => fail("wrong_phase", "No night is running yet.");
  private viewProvider: ViewProvider = (conn) => ({ seq: 0, view: idleView(conn.role ?? "display") });
  private tokenResolver: TeamTokenResolver = () => null;
  private displayAuthoriser: DisplayAuthoriser | null = null;
  private connectListeners: ((conn: Conn) => void)[] = [];
  private disconnectListeners: ((conn: Conn) => void)[] = [];

  constructor(private opts: HubOptions) {}

  // --- plug-in points for B1 ----------------------------------------------

  setCommandHandler(fn: CommandHandler): void { this.commandHandler = fn; }
  setViewProvider(fn: ViewProvider): void { this.viewProvider = fn; }
  setTeamTokenResolver(fn: TeamTokenResolver): void { this.tokenResolver = fn; }
  /** Display pairing (REVIEW finding 4): without one, every display counts as paired. */
  setDisplayAuthoriser(fn: DisplayAuthoriser): void { this.displayAuthoriser = fn; }
  /** True if the connection's host session (from its upgrade request) is still valid. */
  hostSessionAlive(conn: Conn): boolean { return !!conn.hostSession && this.opts.sessionAlive(conn.hostSession); }
  /** A connection by id, if it is open. */
  connection(id: number): Conn | null { const c = this.conns.get(id); return c && !c.closed ? c : null; }
  /** Called after a connection's hello has been accepted (welcome and state sent). */
  onConnect(fn: (conn: Conn) => void): void { this.connectListeners.push(fn); }
  /** Called when a connection that said hello closes. */
  onDisconnect(fn: (conn: Conn) => void): void { this.disconnectListeners.push(fn); }

  /** Connections that have said hello, optionally filtered by role. */
  connections(role?: Role): Conn[] {
    return [...this.conns.values()].filter((c) => !c.closed && c.role !== null && (!role || c.role === role));
  }

  /** Sends a connection its current view. */
  sendState(conn: Conn): void {
    const { seq, view } = this.viewProvider(conn);
    conn.send({ t: "state", seq, serverNow: this.opts.clock.now(), view });
  }

  /**
   * Sends every host connection its view, at most once every HOST_UPDATE_MS (SA-04, SA-03):
   * the first change goes at once, later ones in the window are folded into one send at its end.
   */
  broadcastHosts(): void {
    const now = performance.now();
    if (this.hostTimer) { this.hostPending = true; return; }
    const wait = this.hostLastAt + HOST_UPDATE_MS - now;
    if (wait <= 0) {
      this.hostLastAt = now;
      this.broadcastState((c) => c.role === "host");
      this.hostTimer = setTimeout(() => this.flushHosts(), HOST_UPDATE_MS);
      return;
    }
    this.hostPending = true;
    this.hostTimer = setTimeout(() => this.flushHosts(), wait);
  }

  private flushHosts(): void {
    this.hostTimer = null;
    if (!this.hostPending) return;
    this.hostPending = false;
    this.hostLastAt = performance.now();
    this.broadcastState((c) => c.role === "host");
    this.hostTimer = setTimeout(() => this.flushHosts(), HOST_UPDATE_MS);
  }

  /** Sends every connection its current view (or only those matching `filter`). */
  broadcastState(filter?: (conn: Conn) => boolean): void {
    for (const c of this.connections()) if (!filter || filter(c)) this.sendState(c);
  }

  /** Signs out host connections whose session was deleted (null = all host connections). */
  signOut(hashes: string[] | null): void {
    for (const c of this.connections("host")) {
      if (hashes === null || (c.hostSession && hashes.includes(c.hostSession))) c.bye("signed_out");
    }
  }

  closeAll(): void {
    if (this.hostTimer) { clearTimeout(this.hostTimer); this.hostTimer = null; }
    for (const c of this.conns.values()) {
      if (c.helloTimer) clearTimeout(c.helloTimer);
      c.closed = true;
      try { c.ws.close(1001, "server stopping"); } catch { /* already closed */ }
    }
    this.conns.clear();
  }

  // --- Bun websocket handlers ---------------------------------------------

  /**
   * Admits a socket before the upgrade (SA-04): null when the server or this client IP is
   * at its cap, so the caller can answer 429 and no socket is made. Otherwise the socket's
   * data; its place is held until it closes, or until `release` if the upgrade fails.
   */
  admit(ip: string, hostSession: string | null): SocketData | null {
    const mine = this.socketsByIp.get(ip) ?? 0;
    if (this.socketCount >= MAX_SOCKETS || mine >= MAX_SOCKETS_PER_IP) return null;
    this.socketCount++;
    this.socketsByIp.set(ip, mine + 1);
    return { connId: this.nextId++, ip, hostSession, admitted: true };
  }

  /** Gives back a place taken by `admit` (the socket closed, or the upgrade failed). Safe to call twice. */
  release(data: SocketData): void {
    if (!data.admitted) return;
    data.admitted = false;
    this.socketCount = Math.max(0, this.socketCount - 1);
    const n = (this.socketsByIp.get(data.ip) ?? 1) - 1;
    if (n > 0) this.socketsByIp.set(data.ip, n); else this.socketsByIp.delete(data.ip);
  }

  /** Sockets open (or being opened) now, in total or from one IP. */
  socketsOpen(ip?: string): number {
    return ip === undefined ? this.socketCount : this.socketsByIp.get(ip) ?? 0;
  }

  /** Socket data without the caps (tests that drive the hub directly). */
  upgradeData(ip: string, hostSession: string | null): SocketData {
    return { connId: this.nextId++, ip, hostSession };
  }

  readonly websocket = {
    idleTimeout: IDLE_TIMEOUT_S,
    sendPings: false,
    maxPayloadLength: MAX_MESSAGE_BYTES,
    backpressureLimit: BACKPRESSURE_LIMIT,
    closeOnBackpressureLimit: true,
    open: (ws: ServerWebSocket<SocketData>) => {
      const conn = new Connection(ws, this.opts.clock);
      this.conns.set(conn.id, conn);
      conn.helloTimer = setTimeout(() => {
        if (conn.role === null) conn.bye("protocol");
      }, HELLO_TIMEOUT_MS);
    },
    message: (ws: ServerWebSocket<SocketData>, raw: string | Buffer) => {
      const conn = this.conns.get(ws.data.connId);
      if (!conn || conn.closed) return;
      if (!conn.spend()) return conn.bye("protocol");
      conn.lastMessageAt = this.opts.clock.now();
      let msg: ClientMsg;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
      } catch {
        conn.bye("protocol");
        return;
      }
      this.onMessage(conn, msg).catch((e) => {
        this.opts.log?.(`WebSocket message failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      });
    },
    close: (ws: ServerWebSocket<SocketData>) => {
      this.release(ws.data);
      const conn = this.conns.get(ws.data.connId);
      if (!conn) return;
      conn.closed = true;
      if (conn.helloTimer) clearTimeout(conn.helloTimer);
      this.conns.delete(conn.id);
      if (conn.role !== null) for (const fn of this.disconnectListeners) fn(conn);
    },
  };

  private async onMessage(conn: Connection, msg: ClientMsg): Promise<void> {
    if (typeof msg !== "object" || msg === null) return conn.bye("protocol");

    if (msg.t === "ping") {
      if (typeof msg.c !== "number") return conn.bye("protocol");
      conn.send({ t: "pong", c: msg.c, s: this.opts.clock.now() });
      return;
    }

    if (msg.t === "hello") {
      if (conn.role !== null) return conn.bye("protocol");
      if (msg.protocol !== PROTOCOL || !["host", "display", "team"].includes(msg.role)) return conn.bye("protocol");
      if (msg.role === "host" && !(conn.hostSession && this.opts.sessionAlive(conn.hostSession))) return conn.bye("signed_out");
      if (conn.helloTimer) { clearTimeout(conn.helloTimer); conn.helloTimer = null; }
      conn.role = msg.role;
      if (msg.role === "team" && typeof msg.token === "string" && msg.token.length > 0 && msg.token.length <= 100) {
        conn.teamId = this.tokenResolver(msg.token);
      }
      conn.send({ t: "welcome", protocol: PROTOCOL, role: conn.role, serverNow: this.opts.clock.now(), teamId: conn.teamId });
      if (msg.role === "display" && this.displayAuthoriser) {
        conn.paired = false;
        const token = typeof msg.token === "string" && msg.token.length > 0 && msg.token.length <= 100 ? msg.token : null;
        this.displayAuthoriser(conn, token);
      }
      this.sendState(conn);
      for (const fn of this.connectListeners) fn(conn);
      return;
    }

    if (msg.t === "cmd") {
      if (conn.role === null) return conn.bye("protocol");
      if (typeof msg.id !== "number") return conn.bye("protocol");
      const result = await this.runCommand(conn, msg);
      conn.send(result.ok ? { t: "ack", id: msg.id, ok: true, ...(result.result !== undefined ? { result: result.result } : {}) }
                          : { t: "ack", id: msg.id, ok: false, error: result.error });
      return;
    }

    conn.bye("protocol");
  }

  private async runCommand(conn: Connection, msg: Extract<ClientMsg, { t: "cmd" }>): Promise<CommandResult> {
    const name = msg.name;
    if (!COMMAND_NAMES.includes(name)) return fail("bad_args", "That request was not understood.");
    const args = msg.args;
    if (typeof args !== "object" || args === null || Array.isArray(args)) return fail("bad_args");
    const isTeamCommand = TEAM_COMMANDS.includes(name);
    if (conn.role === "display") return fail("not_allowed");
    if (conn.role === "team" && !isTeamCommand) return fail("not_allowed");
    if (conn.role === "host") {
      if (isTeamCommand) return fail("not_allowed");
      if (!conn.hostSession || !this.opts.sessionAlive(conn.hostSession)) {
        conn.bye("signed_out");
        return fail("not_allowed", "You have been signed out.");
      }
    }
    try {
      return await this.commandHandler(conn, name, args as Record<string, unknown>);
    } catch (e) {
      this.opts.log?.(`Command ${name} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      return fail("server_error");
    }
  }
}

export type BunServer = Server<SocketData>;
