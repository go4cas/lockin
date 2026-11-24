// Display pairing (REVIEW finding 4, NOTES "Display pairing"). /display needs no sign-in (T-01),
// but a display that is not paired sees only a 6-digit pairing code (D2; it changes every 10 minutes): no room code, no QR,
// no questions. The host types that code on the console (`display.pair`), and the display
// gets a token it keeps in localStorage and sends in every hello. A display opened from a
// browser that is signed in to the console is paired by that session, with no token (D5).
//
// Paired tokens are stored as SHA-256 hashes in <data>/displays.json (mode 0600), like
// auth.json, each with an id, when it was paired and when it was last seen (SA-11). A pairing
// unused for 90 days is dropped. The console unpairs one display by id, or every display.

import { randomBytes, randomInt } from "node:crypto";
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
/** A pairing not seen for this long is dropped (SA-11). */
export const PAIRING_UNUSED_MS = 90 * 24 * 60 * MINUTE;
/** lastSeenAt is written at most this often per display, so a reconnecting TV does not rewrite the file each time. */
const SEEN_WRITE_MS = 60 * MINUTE;

/** One paired display, as stored and as listed on the console (HostView.displays.list). */
export interface PairedDisplay { id: string; pairedAt: number; lastSeenAt: number }
interface Stored extends PairedDisplay { tokenHash: string }
interface DisplaysFile { displays: Stored[] }
interface Waiting { code: string; ip: string; at: number }

const newId = () => randomBytes(4).toString("hex");

export class DisplayPairing {
  readonly path: string;
  /** Paired displays by token hash. */
  private stored = new Map<string, Stored>();
  /** Pairing code of each unpaired display connection, by connection id. A code is never moved or reused while its connection is open (SA-03). */
  private codes = new Map<number, Waiting>();
  /** Which stored pairing each open, token-paired display connection uses (for per-display unpair). */
  private live = new Map<number, string>();
  private tries: number[] = [];

  constructor(dataDir: string, private clock: Clock, private log: (message: string) => void = () => {}) {
    this.path = join(dataDir, "displays.json");
    const file = readJsonFile(this.path) as DisplaysFile | undefined;
    const now = clock.now();
    const ids = new Set<string>();
    for (const d of file?.displays ?? []) {
      if (typeof d?.tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(d.tokenHash)) continue;
      // Files from before SA-11 have no id or lastSeenAt: give an id, and count them as seen now.
      let id = typeof d.id === "string" && /^[0-9a-f]{8}$/.test(d.id) && !ids.has(d.id) ? d.id : newId();
      while (ids.has(id)) id = newId();
      ids.add(id);
      const pairedAt = Number(d.pairedAt) || 0;
      const lastSeenAt = Number.isFinite(Number(d.lastSeenAt)) && Number(d.lastSeenAt) > 0 ? Number(d.lastSeenAt) : now;
      this.stored.set(d.tokenHash, { id, tokenHash: d.tokenHash, pairedAt, lastSeenAt });
    }
  }

  /** The stored pairing for a token, if it is paired and not past PAIRING_UNUSED_MS. */
  private lookup(token: string | null | undefined): Stored | null {
    if (typeof token !== "string" || token.length === 0 || token.length > 100) return null;
    const d = this.stored.get(sha256(token));
    if (!d) return null;
    if (this.clock.now() - d.lastSeenAt >= PAIRING_UNUSED_MS) return null;
    return d;
  }

  /** True if the token belongs to a paired display. */
  isPaired(token: string | null | undefined): boolean {
    return this.lookup(token) !== null;
  }

  /**
   * At hello: the pairing id if this token is paired (and records it as seen, and which
   * connection uses it), else null. A pairing unused for 90 days is dropped here (SA-11).
   */
  connect(connId: number, token: string | null): string | null {
    const d = this.lookup(token);
    if (!d) {
      this.dropUnused();   // writes only when a pairing has passed its 90 days
      return null;
    }
    const now = this.clock.now();
    if (now - d.lastSeenAt >= SEEN_WRITE_MS) {
      d.lastSeenAt = now;
      try { this.save(this.stored); } catch (e) { this.log(`Could not save when a display was last seen: ${e instanceof Error ? e.message : String(e)}`); }
    }
    this.live.set(connId, d.id);
    return d.id;
  }

  /** A display connection closed or was unpaired. */
  disconnect(connId: number): void {
    this.live.delete(connId);
  }

  /** Open connections using a stored pairing. */
  connectionsOf(id: string): number[] {
    return [...this.live].filter(([, d]) => d === id).map(([c]) => c);
  }

  /** The pairing id an open connection uses, if it was paired by a token. */
  pairingOf(connId: number): string | null {
    return this.live.get(connId) ?? null;
  }

  /**
   * Pairs a new display: returns the token it must keep and its id. The file is written first
   * and memory changed only once that worked (LI-014), so a failed write changes nothing.
   */
  issue(): { token: string; id: string } {
    const token = randomToken();
    const now = this.clock.now();
    const ids = new Set([...this.stored.values()].map((d) => d.id));
    let id = newId();
    while (ids.has(id)) id = newId();
    const next = new Map(this.stored);
    const tokenHash = sha256(token);
    next.set(tokenHash, { id, tokenHash, pairedAt: now, lastSeenAt: now });
    this.save(next);
    this.stored = next;
    return { token, id };
  }

  /** Forgets one paired display (SA-11). False if there is no such id. Memory changes only after the write. */
  unpair(id: string): boolean {
    const next = new Map([...this.stored].filter(([, d]) => d.id !== id));
    if (next.size === this.stored.size) return false;
    this.save(next);
    this.stored = next;
    return true;
  }

  /** Forgets every paired display. Returns how many there were. Like issue(), memory changes only after the write. */
  unpairAll(): number {
    const n = this.stored.size;
    this.save(new Map());
    this.stored = new Map();
    return n;
  }

  /** Records every connected, token-paired display as seen (a TV that stays connected for months is in use). */
  markConnectedSeen(): void {
    const now = this.clock.now();
    const ids = new Set(this.live.values());
    let changed = false;
    for (const d of this.stored.values()) {
      if (ids.has(d.id) && now - d.lastSeenAt >= SEEN_WRITE_MS) { d.lastSeenAt = now; changed = true; }
    }
    if (!changed) return;
    try { this.save(this.stored); } catch (e) { this.log(`Could not save when displays were last seen: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** Drops pairings unused for PAIRING_UNUSED_MS (SA-11). Returns how many. */
  dropUnused(): number {
    const now = this.clock.now();
    const next = new Map([...this.stored].filter(([, d]) => now - d.lastSeenAt < PAIRING_UNUSED_MS));
    const n = this.stored.size - next.size;
    if (n === 0) return 0;
    try {
      this.save(next);
      this.stored = next;
    } catch (e) {
      this.log(`Could not drop unused display pairings: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
    return n;
  }

  /** Paired displays, oldest pairing first. */
  list(): PairedDisplay[] {
    return [...this.stored.values()].sort((a, b) => a.pairedAt - b.pairedAt)   // stable: same time keeps pairing order
      .map(({ id, pairedAt, lastSeenAt }) => ({ id, pairedAt, lastSeenAt }));
  }

  get pairedCount(): number { return this.stored.size; }

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

  private save(stored: Map<string, Stored>): void {
    const file: DisplaysFile = { displays: [...stored.values()].map(({ id, tokenHash, pairedAt, lastSeenAt }) => ({ id, tokenHash, pairedAt, lastSeenAt })) };
    writeJsonAtomic(this.path, file, 0o600);
  }
}
