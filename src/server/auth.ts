// Host password, setup code and host sessions (TECH-SPEC 12.1, 12.2).

import type { Database } from "bun:sqlite";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, removeFile, writeJsonAtomic, writeTextAtomic } from "./files.ts";

/** Rejoin, move and setup code alphabet: no 0, O, 1, I or L (TECH-SPEC 11.2). */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const SESSION_COOKIE = "lockin_host";
export const SESSION_DAYS = 7;
/** A session ends this long after sign-in, however much it is used (SA-12). */
export const SESSION_MAX_DAYS = 30;
export const MIN_PASSWORD = 8;
const DAY = 24 * 60 * 60 * 1000;
const RENEW_AFTER = 60 * 60 * 1000;  // re-send the cookie at most once an hour

export function randomCode(length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface AuthFile { passwordHash: string; setAt: number }

export interface Clock { now(): number }

/**
 * Counts failures per key (a client IP). After `max` failures within `windowMs` the key is
 * blocked (TECH-SPEC 12.2: 5 a minute). Each block is twice the last (SA-08): 1 minute, then
 * 2, 4, 8, up to 15, until a good sign-in resets it or the key has been quiet for a day.
 * When more than `maxKeys` keys are held the oldest are dropped, never the newest (SA-08).
 */
export class RateLimiter {
  /** Failures in the window, per key; Map order is the order keys last failed. */
  private failures = new Map<string, number[]>();
  /** Current or last block per key, and how many blocks in a row it has had. */
  private blocks = new Map<string, { until: number; strikes: number }>();
  constructor(
    private clock: Clock,
    private max = 5,
    private windowMs = 60_000,
    private blockMs = 60_000,
    private maxBlockMs = 15 * 60_000,
    private maxKeys = 10_000,
  ) {}

  /** Strikes are forgotten this long after a key's last block ended. */
  static readonly STRIKE_MEMORY_MS = 24 * 60 * 60_000;

  blocked(key: string): boolean {
    const b = this.blocks.get(key);
    return !!b && this.clock.now() < b.until;
  }

  /** How long the key is blocked for from now (0 when it is not). */
  blockedFor(key: string): number {
    const b = this.blocks.get(key);
    return b ? Math.max(0, b.until - this.clock.now()) : 0;
  }

  fail(key: string): void {
    const now = this.clock.now();
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.failures.delete(key);   // re-insert so the Map's order stays "last failed"
    if (list.length >= this.max) {
      const last = this.blocks.get(key);
      const strikes = last && now - last.until < RateLimiter.STRIKE_MEMORY_MS ? last.strikes + 1 : 1;
      this.blocks.delete(key);
      this.blocks.set(key, { until: now + Math.min(this.blockMs * 2 ** (strikes - 1), this.maxBlockMs), strikes });
    } else {
      this.failures.set(key, list);
    }
    this.prune(now);
  }

  succeed(key: string): void {
    this.failures.delete(key);
    this.blocks.delete(key);
  }

  /** Keys held now (tests). */
  get size(): { failures: number; blocks: number } {
    return { failures: this.failures.size, blocks: this.blocks.size };
  }

  /** Bounds memory on a busy public server: drop finished entries, then the oldest keys. */
  private prune(now: number): void {
    if (this.failures.size > this.maxKeys) {
      for (const [k, list] of this.failures) if (list.every((t) => now - t >= this.windowMs)) this.failures.delete(k);
      for (const k of this.failures.keys()) { if (this.failures.size <= this.maxKeys) break; this.failures.delete(k); }
    }
    if (this.blocks.size > this.maxKeys) {
      for (const [k, b] of this.blocks) if (now - b.until >= RateLimiter.STRIKE_MEMORY_MS) this.blocks.delete(k);
      for (const [k, b] of this.blocks) { if (this.blocks.size <= this.maxKeys) break; if (b.until <= now) this.blocks.delete(k); }
    }
  }
}

/** Thrown by HashGate when too many password checks are already running or waiting (SA-08). */
export class Busy extends Error {
  constructor() { super("Lock-In is busy. Try again in a moment."); }
}

/**
 * Lets at most `running` password hashes run at once, with `waiting` more queued; past that
 * `run` throws Busy at once (SA-08). argon2id takes about 100 ms and 64 MiB each.
 */
export class HashGate {
  private active = 0;
  private queue: (() => void)[] = [];
  /** Most hashes that ran at once (tests). */
  peak = 0;
  constructor(readonly running = 2, readonly waiting = 8) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.running) {
      if (this.queue.length >= this.waiting) throw new Busy();
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active++;
    }
    // Here this call holds a place (taken above, or handed over by the one that finished).
    this.peak = Math.max(this.peak, this.active);
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next(); else this.active--;
    }
  }
}

/** How passwords are hashed and checked; tests inject a slow fake to count what runs at once. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export const bunHasher: PasswordHasher = {
  hash: (password) => Bun.password.hash(password, { algorithm: "argon2id" }),
  verify: (password, hash) => Bun.password.verify(password, hash),
};

export class Auth {
  readonly authPath: string;
  readonly codePath: string;
  /** Called with the deleted session hashes, or null when every session was deleted. */
  onSessionsDeleted: ((hashes: string[] | null) => void) | null = null;

  /** At most 2 password hashes at once, 8 waiting (SA-08). */
  readonly hashGate = new HashGate();

  constructor(private db: Database, dataDir: string, private clock: Clock, readonly secureCookie: boolean, private hasher: PasswordHasher = bunHasher) {
    this.authPath = join(dataDir, "auth.json");
    this.codePath = join(dataDir, "setup-code");
  }

  // --- password -----------------------------------------------------------

  setupNeeded(): boolean {
    return !existsSync(this.authPath);
  }

  private readAuthFile(): AuthFile | null {
    try {
      const raw = readJsonFile(this.authPath) as AuthFile | undefined;
      return raw && typeof raw.passwordHash === "string" ? raw : null;
    } catch {
      return null;
    }
  }

  async setPassword(password: string): Promise<void> {
    const passwordHash = await this.hashGate.run(() => this.hasher.hash(password));   // Busy when full (SA-08)
    writeJsonAtomic(this.authPath, { passwordHash, setAt: this.clock.now() } satisfies AuthFile, 0o600);
    removeFile(this.codePath);
    this.deleteAllSessions();
  }

  async verifyPassword(password: string): Promise<boolean> {
    const file = this.readAuthFile();
    if (!file) return false;
    try {
      return await this.hashGate.run(() => this.hasher.verify(password, file.passwordHash));
    } catch (e) {
      if (e instanceof Busy) throw e;   // the caller answers 429 (SA-08)
      return false;
    }
  }

  /** `lockin reset-password`: removes the password, signs out every session, makes a new setup code. */
  resetPassword(): string {
    removeFile(this.authPath);
    this.deleteAllSessions();
    removeFile(this.codePath);
    return this.ensureSetupCode()!;
  }

  // --- setup code ---------------------------------------------------------
  // Kept in <dataDir>/setup-code so that `lockin setup-code`, a separate
  // process, can print the code the running server checks against.

  setupCode(): string | null {
    try {
      const code = readFileSync(this.codePath, "utf8").trim();
      return code.length === 8 ? code : null;
    } catch {
      return null;
    }
  }

  /** Makes a setup code if no password is set and none exists yet. Returns the current code, or null if a password is set. */
  ensureSetupCode(): string | null {
    if (!this.setupNeeded()) return null;
    const existing = this.setupCode();
    if (existing) return existing;
    const code = randomCode(8);
    writeTextAtomic(this.codePath, code + "\n", 0o600);
    return code;
  }

  checkSetupCode(given: unknown): boolean {
    const code = this.setupCode();
    if (!code || typeof given !== "string") return false;
    return sameText(given.trim().toUpperCase(), code);
  }

  // --- sessions -----------------------------------------------------------

  createSession(): string {
    const token = randomToken();
    const now = this.clock.now();
    this.db.query("INSERT INTO host_sessions (token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(sha256(token), now, now, now + SESSION_DAYS * DAY);
    return token;
  }

  /** The renewed expiry: 7 days from now, but never past 30 days from sign-in (SA-12). */
  private expiryFrom(now: number, createdAt: number): number {
    return Math.min(now + SESSION_DAYS * DAY, createdAt + SESSION_MAX_DAYS * DAY);
  }

  /**
   * Checks a session token and renews it on use. Returns null if it is not valid;
   * `renewCookie` is true when the cookie should be sent again with a fresh expiry.
   */
  checkSession(token: string | null | undefined): { hash: string; renewCookie: boolean } | null {
    if (!token || token.length > 100) return null;
    const hash = sha256(token);
    const row = this.db.query<{ created_at: number; last_seen_at: number; expires_at: number }, [string]>(
      "SELECT created_at, last_seen_at, expires_at FROM host_sessions WHERE token_hash = ?").get(hash);
    const now = this.clock.now();
    if (!row) return null;
    const expires = Math.min(row.expires_at, row.created_at + SESSION_MAX_DAYS * DAY);
    if (expires <= now) {
      this.db.query("DELETE FROM host_sessions WHERE token_hash = ?").run(hash);
      return null;
    }
    const renewCookie = now - row.last_seen_at >= RENEW_AFTER;
    if (renewCookie || now - row.last_seen_at >= 60_000) {
      this.db.query("UPDATE host_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?")
        .run(now, this.expiryFrom(now, row.created_at), hash);
    }
    return { hash, renewCookie };
  }

  /**
   * Renews a live session from host socket activity (SA-12), so a console left open through a
   * night does not expire under the host. At most one write a minute. False if it has ended.
   */
  touchSession(hash: string): boolean {
    const row = this.db.query<{ created_at: number; last_seen_at: number; expires_at: number }, [string]>(
      "SELECT created_at, last_seen_at, expires_at FROM host_sessions WHERE token_hash = ?").get(hash);
    const now = this.clock.now();
    if (!row || Math.min(row.expires_at, row.created_at + SESSION_MAX_DAYS * DAY) <= now) return false;
    if (now - row.last_seen_at >= 60_000) {
      this.db.query("UPDATE host_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?")
        .run(now, this.expiryFrom(now, row.created_at), hash);
    }
    return true;
  }

  /** True if the session (by hash) still exists and has not expired. */
  sessionAlive(hash: string): boolean {
    const row = this.db.query<{ created_at: number; expires_at: number }, [string]>(
      "SELECT created_at, expires_at FROM host_sessions WHERE token_hash = ?").get(hash);
    return !!row && Math.min(row.expires_at, row.created_at + SESSION_MAX_DAYS * DAY) > this.clock.now();
  }

  /** Deletes sessions that have ended (SA-12: the table only shrank when an old cookie came back). Returns how many. */
  pruneSessions(): number {
    const now = this.clock.now();
    return this.db.query("DELETE FROM host_sessions WHERE expires_at <= ? OR created_at <= ?")
      .run(now, now - SESSION_MAX_DAYS * DAY).changes;
  }

  deleteSession(token: string): void {
    const hash = sha256(token);
    this.db.query("DELETE FROM host_sessions WHERE token_hash = ?").run(hash);
    this.onSessionsDeleted?.([hash]);
  }

  deleteAllSessions(): void {
    this.db.exec("DELETE FROM host_sessions");
    this.onSessionsDeleted?.(null);
  }

  // --- cookies ------------------------------------------------------------

  sessionCookie(token: string): string {
    return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${this.secureCookie ? "; Secure" : ""}`;
  }

  clearCookie(): string {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${this.secureCookie ? "; Secure" : ""}`;
  }
}

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
