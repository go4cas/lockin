// Runtime configuration (TECH-SPEC 4.2, hosted only since PR 5).
// Precedence: command-line flag, then environment variable, then config.json
// in the data folder, then the default.

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJsonFile } from "./files.ts";

export interface Config {
  dataDir: string;      // absolute path
  port: number;
  bind: string;
  publicUrl: string;    // origin only, no trailing slash, e.g. "https://quiz.example.com"
}

export type Command = "serve" | "reset-password" | "setup-code" | "version" | "help";

export interface ParsedArgs {
  command: Command;
  flags: { data?: string; port?: string; bind?: string; publicUrl?: string };
}

export const DEFAULTS = { dataDir: "./lockin-data", port: 8080, bind: "127.0.0.1" } as const;

/** Subfolders created in the data folder on start (TECH-SPEC 5.1). */
export const DATA_SUBFOLDERS = ["theme/assets", "quizzes", "backups"] as const;

export class ConfigError extends Error {}

const FLAG_NAMES: Record<string, keyof ParsedArgs["flags"]> = {
  "--data": "data", "--port": "port", "--bind": "bind", "--public-url": "publicUrl",
};

/** Parses `lockin [command] [--flag value | --flag=value]...`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: "serve", flags: {} };
  let commandSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--version" || arg === "-v") { out.command = "version"; continue; }
    if (arg === "--help" || arg === "-h") { out.command = "help"; continue; }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg : arg.slice(0, eq);
      const key = FLAG_NAMES[name];
      if (!key) throw new ConfigError(`Unknown option ${name}. Run "lockin --help" for the options.`);
      let value: string | undefined;
      if (eq !== -1) value = arg.slice(eq + 1);
      else { value = argv[i + 1]; i++; }
      if (value === undefined || value === "") throw new ConfigError(`Option ${name} needs a value.`);
      out.flags[key] = value;
      continue;
    }
    if (commandSeen) throw new ConfigError(`Unexpected "${arg}". Run "lockin --help" for the commands.`);
    if (arg === "serve" || arg === "reset-password" || arg === "setup-code") { out.command = arg; commandSeen = true; continue; }
    throw new ConfigError(`Unknown command "${arg}". Run "lockin --help" for the commands.`);
  }
  return out;
}

/**
 * The data folder comes from the flag, the environment or the default only:
 * config.json lives inside it, so it cannot choose it.
 */
export function resolveDataDir(flags: ParsedArgs["flags"], env: Record<string, string | undefined>, cwd: string): string {
  return resolve(cwd, flags.data ?? env.LOCKIN_DATA ?? DEFAULTS.dataDir);
}

function parsePort(v: unknown, source: string): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new ConfigError(`The port from ${source} must be a whole number from 0 to 65535.`);
  return n;
}

/** Checks a public URL and returns its origin (no path, no trailing slash). */
export function parsePublicUrl(v: unknown, source: string): string {
  let url: URL;
  try { url = new URL(String(v)); } catch { throw new ConfigError(`The public URL from ${source} is not a web address.`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ConfigError(`The public URL from ${source} must start with https:// (or http:// in development).`);
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username || url.password) {
    throw new ConfigError(`The public URL from ${source} must be just the address, like https://quiz.example.com, with no path.`);
  }
  return url.origin;
}

/**
 * Resolves the full config. Reads `<dataDir>/config.json` if it exists.
 * Throws ConfigError with a plain-English message when the config is unusable,
 * including when no public URL is set (the server refuses to start without one).
 */
export function resolveConfig(args: ParsedArgs, env: Record<string, string | undefined>, cwd: string): Config {
  const dataDir = resolveDataDir(args.flags, env, cwd);
  const filePath = join(dataDir, "config.json");
  let file: Record<string, unknown> = {};
  try {
    const raw = readJsonFile(filePath);
    if (raw !== undefined) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("not an object");
      file = raw as Record<string, unknown>;
    }
  } catch {
    throw new ConfigError(`${filePath} is not valid JSON. Fix or delete it and start again.`);
  }

  const pick = (flag: string | undefined, envName: string, key: string): { value: unknown; source: string } | undefined => {
    if (flag !== undefined) return { value: flag, source: `--${key === "publicUrl" ? "public-url" : key}` };
    const e = env[envName];
    if (e !== undefined && e !== "") return { value: e, source: envName };
    if (file[key] !== undefined && file[key] !== null) return { value: file[key], source: "config.json" };
    return undefined;
  };

  const port = pick(args.flags.port, "LOCKIN_PORT", "port");
  const bind = pick(args.flags.bind, "LOCKIN_BIND", "bind");
  const publicUrl = pick(args.flags.publicUrl, "LOCKIN_PUBLIC_URL", "publicUrl");

  if (!publicUrl) {
    throw new ConfigError("No public URL is set, so Lock-In cannot make join links. Start it with --public-url https://quiz.example.com (or set LOCKIN_PUBLIC_URL).");
  }
  if (bind && (typeof bind.value !== "string" || bind.value.trim() === "")) throw new ConfigError(`The bind address from ${bind.source} must be an IP address.`);

  return {
    dataDir,
    port: port ? parsePort(port.value, port.source) : DEFAULTS.port,
    bind: bind ? (bind.value as string).trim() : DEFAULTS.bind,
    publicUrl: parsePublicUrl(publicUrl.value, publicUrl.source),
  };
}

/** Creates the data folder and its subfolders if they are missing (TECH-SPEC 4.4 step 1). */
export function ensureDataDir(dataDir: string): void {
  for (const sub of ["", ...DATA_SUBFOLDERS]) {
    const p = join(dataDir, sub);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

/** True when the public URL is a development address on this machine (no HTTPS, so no Secure cookie). */
export function isLocalDevUrl(publicUrl: string): boolean {
  const u = new URL(publicUrl);
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
}
