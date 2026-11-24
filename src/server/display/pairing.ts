// Display pairing (REVIEW finding 4, NOTES "Display pairing"). /display needs no sign-in (T-01),
// but a display that is not paired sees only a 4-digit pairing code: no room code, no QR,
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

export const PAIR_CODE_DIGITS = 4;
/** Pairing tries a minute from the console; guards against a script with a host session typing codes. */
const PAIR_TRIES = 10;
const MINUTE = 60_000;

interface DisplaysFile { displays: { tokenHash: string; pairedAt: number }[] }

export class DisplayPairing {
  readonly path: string;
  private hashes = new Map<string, number>();
  /** Pairing code of each unpaired display connection, by connection id. */
  private codes = new Map<number, string>();
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

  /** Pairs a new display: returns the token it must keep. */
  issue(): string {
    const token = randomToken();
    this.hashes.set(sha256(token), this.clock.now());
    this.save();
    return token;
  }

  /** Forgets every paired display. Returns how many there were. */
  unpairAll(): number {
    const n = this.hashes.size;
    this.hashes.clear();
    this.save();
    return n;
  }

  get pairedCount(): number { return this.hashes.size; }

  /** The pairing code shown on an unpaired display connection (made on first use, unique among them). */
  codeFor(connId: number): string {
    let code = this.codes.get(connId);
    if (code) return code;
    const used = new Set(this.codes.values());
    if (used.size >= 10 ** PAIR_CODE_DIGITS / 2) {
      // Far more waiting displays than any pub has: drop the oldest half rather than loop for a free code.
      for (const id of [...this.codes.keys()].slice(0, used.size / 2)) this.codes.delete(id);
      used.clear();
      for (const c of this.codes.values()) used.add(c);
    }
    do code = String(randomInt(10 ** PAIR_CODE_DIGITS)).padStart(PAIR_CODE_DIGITS, "0"); while (used.has(code));
    this.codes.set(connId, code);
    return code;
  }

  /** Connection ids waiting with a code. */
  get waitingCount(): number { return this.codes.size; }

  /** The connection whose pairing code this is, or a reason it can't be paired. */
  claim(code: unknown): { connId: number } | { error: "bad_code" | "too_many_tries" } {
    const now = this.clock.now();
    this.tries = this.tries.filter((t) => t > now - MINUTE);
    if (this.tries.length >= PAIR_TRIES) return { error: "too_many_tries" };
    const clean = typeof code === "string" ? code.replace(/\s+/g, "") : "";
    for (const [connId, c] of this.codes) {
      if (c === clean) { this.codes.delete(connId); return { connId }; }
    }
    this.tries.push(now);
    return { error: "bad_code" };
  }

  /** A connection closed or was paired: its code is free again. */
  forget(connId: number): void {
    this.codes.delete(connId);
  }

  private save(): void {
    const file: DisplaysFile = { displays: [...this.hashes].map(([tokenHash, pairedAt]) => ({ tokenHash, pairedAt })) };
    writeJsonAtomic(this.path, file, 0o600);
  }
}
