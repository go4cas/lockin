// Display pairing (REVIEW finding 4, NOTES "Display pairing"). /display needs no sign-in (T-01),
// but a display that is not paired sees only a 6-digit pairing code (D2; it changes every 10 minutes): no room code, no QR,
// no questions. The host types that code on the console (`display.pair`), and the display
// gets a token it keeps in localStorage and sends in every hello. A display opened from a
// browser that is signed in to the console is paired at once.
//
// Paired tokens are stored as SHA-256 hashes in <data>/displays.json (mode 0600), like
// auth.json. "Unpair every display" on the console empties it.

import { randomInt } from "node:crypto";
import { join } from "node:path";
import type { Clock } from "../auth.ts";
import { randomToken, sha256 } from "../auth.ts";
import { readJsonFile, writeJsonAtomic } from "../files.ts";

export const PAIR_CODE_DIGITS = 6;
/** A pairing code is shown for this long, then the display gets a new one (D2). */
export const PAIR_CODE_TTL_MS = 10 * 60_000;
/** Unpaired displays that may hold a code at once, in total and per client IP (SA-03). */
export const MAX_WAITING = 20;
export const MAX_WAITING_PER_IP = 5;
/** Pairing tries a minute from the console; guards against a script with a host session typing codes. */
const PAIR_TRIES = 10;
const MINUTE = 60_000;

interface DisplaysFile { displays: { tokenHash: string; pairedAt: number }[] }
interface Waiting { code: string; ip: string; at: number }

export class DisplayPairing {
  readonly path: string;
  private hashes = new Map<string, number>();
  /** Pairing code of each unpaired display connection, by connection id. A code is never moved or reused while its connection is open (SA-03). */
  private codes = new Map<number, Waiting>();
  private tries: number[] = [];

  constructor(dataDir: string, private clock: Clock) {
    this.path = join(dataDir, "displays.json");
    const file = readJsonFile(this.path) as DisplaysFile | undefined;
    for (const d of file?.displays ?? []) {
      if (typeof d?.tokenHash === "string" && /^[0-9a-f]{64}$/.test(d.tokenHash)) this.hashes.set(d.tokenHash, Number(d.pairedAt) || 0);
    }
  }

  /** True if the token belongs to a paired display. */
  isPaired(token: string | null | undefined): boolean {
    return typeof token === "string" && token.length > 0 && token.length <= 100 && this.hashes.has(sha256(token));
  }

  /**
   * Pairs a new display: returns the token it must keep. The file is written first and memory
   * changed only once that worked (LI-014), so a failed write changes nothing.
   */
  issue(): string {
    const token = randomToken();
    const next = new Map(this.hashes);
    next.set(sha256(token), this.clock.now());
    this.save(next);
    this.hashes = next;
    return token;
  }

  /** Forgets every paired display. Returns how many there were. Like issue(), memory changes only after the write. */
  unpairAll(): number {
    const n = this.hashes.size;
    this.save(new Map());
    this.hashes = new Map();
    return n;
  }

  get pairedCount(): number { return this.hashes.size; }

  /**
   * The pairing code shown on an unpaired display connection, made on first use and unique
   * among open connections. A code older than PAIR_CODE_TTL_MS is replaced. Returns "" (no
   * code) while MAX_WAITING displays, or MAX_WAITING_PER_IP from this IP, already hold one.
   */
  codeFor(connId: number, ip: string): string {
    const now = this.clock.now();
    const held = this.codes.get(connId);
    if (held && now - held.at < PAIR_CODE_TTL_MS) return held.code;
    if (!held) {
      if (this.codes.size >= MAX_WAITING) return "";
      let mine = 0;
      for (const w of this.codes.values()) if (w.ip === ip) mine++;
      if (mine >= MAX_WAITING_PER_IP) return "";
    }
    const used = new Set([...this.codes.values()].map((w) => w.code));
    if (held) used.add(held.code);   // an expired code is not given straight back
    let code: string;
    do code = String(randomInt(10 ** PAIR_CODE_DIGITS)).padStart(PAIR_CODE_DIGITS, "0"); while (used.has(code));
    this.codes.set(connId, { code, ip, at: now });
    return code;
  }

  /** Connections whose code has expired, so the caller can send them a new one at once. */
  expired(): number[] {
    const now = this.clock.now();
    return [...this.codes].filter(([, w]) => now - w.at >= PAIR_CODE_TTL_MS).map(([id]) => id);
  }

  /** Connection ids waiting with a code. */
  get waitingCount(): number { return this.codes.size; }

  /** True if this connection holds a code now. */
  holds(connId: number): boolean { return this.codes.has(connId); }

  /** Where and since when a waiting connection has shown its code (for the host's "Not your TV?" check). */
  waiting(connId: number): Waiting | null { return this.codes.get(connId) ?? null; }

  /**
   * The connection whose pairing code this is, or a reason it can't be paired. The code stays
   * held until the caller calls `forget` after pairing worked (LI-014), so a failed pairing
   * can be tried again with the same code.
   */
  claim(code: unknown): { connId: number } | { error: "bad_code" | "too_many_tries" } {
    const now = this.clock.now();
    this.tries = this.tries.filter((t) => t > now - MINUTE);
    if (this.tries.length >= PAIR_TRIES) return { error: "too_many_tries" };
    const clean = typeof code === "string" ? code.replace(/\s+/g, "") : "";
    for (const [connId, w] of this.codes) {
      if (w.code === clean && now - w.at < PAIR_CODE_TTL_MS) return { connId };
    }
    this.tries.push(now);
    return { error: "bad_code" };
  }

  /** A connection closed or was paired: its code is free again. */
  forget(connId: number): void {
    this.codes.delete(connId);
  }

  private save(hashes: Map<string, number>): void {
    const file: DisplaysFile = { displays: [...hashes].map(([tokenHash, pairedAt]) => ({ tokenHash, pairedAt })) };
    writeJsonAtomic(this.path, file, 0o600);
  }
}
