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
 * Counts failures per key (a client IP). After `max` failures within `windowMs`
 * the key is blocked for `blockMs` (TECH-SPEC 12.2: 5 per minute, then a 1-minute wait).
 */
export class RateLimiter {
  private failures = new Map<string, number[]>();
  private blockedUntil = new Map<string, number>();
  constructor(private clock: Clock, private max = 5, private windowMs = 60_000, private blockMs = 60_000) {}

  blocked(key: string): boolean {
    const until = this.blockedUntil.get(key);
    if (until === undefined) return false;
    if (this.clock.now() < until) return true;
    this.blockedUntil.delete(key);
    this.failures.delete(key);
    return false;
  }

  fail(key: string): void {
    const now = this.clock.now();
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.failures.set(key, list);
    if (list.length >= this.max) this.blockedUntil.set(key, now + this.blockMs);
    if (this.failures.size > 10_000) this.failures.clear();   // bound memory on a busy public server
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}

export class Auth {
  readonly authPath: string;
  readonly codePath: string;
  /** Called with the deleted session hashes, or null when every session was deleted. */
  onSessionsDeleted: ((hashes: string[] | null) => void) | null = null;

  constructor(private db: Database, dataDir: string, private clock: Clock, readonly secureCookie: boolean) {
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
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    writeJsonAtomic(this.authPath, { passwordHash, setAt: this.clock.now() } satisfies AuthFile, 0o600);
    removeFile(this.codePath);
    this.deleteAllSessions();
  }

  async verifyPassword(password: string): Promise<boolean> {
    const file = this.readAuthFile();
    if (!file) return false;
    try {
      return await Bun.password.verify(password, file.passwordHash);
    } catch {
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

  /**
   * Checks a session token and renews it on use. Returns null if it is not valid;
   * `renewCookie` is true when the cookie should be sent again with a fresh expiry.
   */
  checkSession(token: string | null | undefined): { hash: string; renewCookie: boolean } | null {
    if (!token || token.length > 100) return null;
    const hash = sha256(token);
    const row = this.db.query<{ last_seen_at: number; expires_at: number }, [string]>(
      "SELECT last_seen_at, expires_at FROM host_sessions WHERE token_hash = ?").get(hash);
    const now = this.clock.now();
    if (!row) return null;
    if (row.expires_at <= now) {
      this.db.query("DELETE FROM host_sessions WHERE token_hash = ?").run(hash);
      return null;
    }
    const renewCookie = now - row.last_seen_at >= RENEW_AFTER;
    if (renewCookie || now - row.last_seen_at >= 60_000) {
      this.db.query("UPDATE host_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?")
        .run(now, now + SESSION_DAYS * DAY, hash);
    }
    return { hash, renewCookie };
  }

  /** True if the session (by hash) still exists and has not expired. */
  sessionAlive(hash: string): boolean {
    const row = this.db.query<{ expires_at: number }, [string]>("SELECT expires_at FROM host_sessions WHERE token_hash = ?").get(hash);
    return !!row && row.expires_at > this.clock.now();
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
