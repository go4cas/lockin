// Small file helpers shared by the server modules.

import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Writes JSON atomically (TECH-SPEC 5.1): write `<name>.tmp`, then rename.
 * Two-space indentation and a trailing newline, so files diff cleanly in git.
 * Key order is the caller's object order: build objects in the format's field order.
 */
export function writeJsonAtomic(path: string, value: unknown, mode?: number): void {
  writeTextAtomic(path, JSON.stringify(value, null, 2) + "\n", mode);
}

export function writeTextAtomic(path: string, text: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
  renameSync(tmp, path);
}

/** Reads and parses a JSON file. Returns `undefined` if the file does not exist; throws on bad JSON. */
export function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function removeFile(path: string): void {
  rmSync(path, { force: true });
}
