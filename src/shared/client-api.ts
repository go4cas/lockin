// The browser globals page code uses (code review LI-019): window.LockIn, set up by the
// classic scripts in public/shared/ (ws-client.js, clock.js, view.js, source.js).
// Types only: page code reads them through JSDoc and `bun run typecheck` checks every call,
// so a renamed command argument or a wrong result field fails the typecheck.

import type { CommandArgs, CommandName, CommandResults, Role, ServerMsg, View } from "./protocol.ts";

export type ClientStatus = "connecting" | "online" | "offline";
export type ByeReason = Extract<ServerMsg, { t: "bye" }>["reason"];

/** The server-time clock (public/shared/clock.js, TECH-SPEC 10.6). */
export interface LockInClock {
  sample(c: number, s: number, now?: number): void;
  seed(serverNow: number): void;
  offset(): number;
  /** The server's time now, as this page best knows it. */
  now(): number;
  /** Milliseconds from now until a server time (never below 0). */
  remaining(serverTime: number): number;
}

export interface ConnectOptions<V extends View = View> {
  role: Role;
  url?: string;
  getToken?: () => string | null;
  onState?: (view: V, msg: Extract<ServerMsg, { t: "state" }>) => void;
  onStatus?: (status: ClientStatus) => void;
  onWelcome?: (msg: Extract<ServerMsg, { t: "welcome" }>) => void;
  onBye?: (reason: ByeReason) => void;
  onPaired?: (token: string) => void;
}

/** A connected client (public/shared/ws-client.js). */
export interface LockInClient {
  readonly clock: LockInClock;
  /**
   * Sends a command. Resolves with the ack's result; rejects with a CommandError
   * (src/shared/protocol.ts): a server refusal, `disconnected` or `timeout`.
   */
  cmd<N extends CommandName>(name: N, args: CommandArgs[N]): Promise<CommandResults[N]>;
  reconnect(): void;
  close(): void;
}

export interface LockInGlobal {
  readonly PROTOCOL: number;
  connect<V extends View = View>(opts: ConnectOptions<V>): LockInClient;
  backoff(attempt: number, random?: () => number): number;
  isFixtureHost(loc: { hostname: string } | null | undefined): boolean;
  createClock(): LockInClock;
  /** Where this build's source is (AGPL section 13), set in public/shared/source.js. */
  readonly SOURCE_URL?: string;
  /** Calls back with the running server's version ("0.3.1"), from /api/ping (public/shared/source.js). */
  readonly version?: (done: (version: string) => void) => void;
  /** The Lock-In lockup as a DOM node (host console, public/host/nav.js). */
  readonly lockup?: (mono: boolean) => HTMLElement;
  /** The host console's top nav (public/host/nav.js): marks Run night while a night is open. */
  readonly nav?: {
    setNight(roomCode: string | null): void;
    /** The design system's confirm dialog (UI-41); never the browser's confirm(). */
    ask(o: { title: string; text: string; ok: string; cancel: string; danger?: boolean; className?: string }): Promise<boolean>;
  };
  readonly view: {
    countdown(ms: number, short?: boolean): string;
    joinNames(names: string[]): string;
    teamColour(index: number): string;
    initials(name: string): string;
    el(tag: string, attrs?: Record<string, unknown>, children?: unknown[]): HTMLElement;
    replace(node: Element, children: unknown[]): void;
  };
}

declare global {
  interface Window {
    /** Lock-In's shared browser helpers; present once the page's classic scripts ran. */
    LockIn: LockInGlobal;
  }
}
