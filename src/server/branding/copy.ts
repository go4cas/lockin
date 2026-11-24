// Copy pools and the copy picker (TECH-SPEC 5.5 and 8.6, S-10).

import type { ThemeFile } from "../../shared/formats.ts";
import type { CopyPicker } from "../../shared/rules-api.ts";

export type Pools = Record<string, string[]>;
export type CopyVars = Parameters<CopyPicker["pick"]>[1];

/**
 * Flattens docs/brand/copy.en.json into pools by key: every array is a pool,
 * named by its own key (so "voice.lobby" is pool "lobby", and "taglines" is "taglines").
 * Keys starting with "$" are comments.
 */
export function poolsFromCopyFile(json: unknown): Pools {
  const pools: Pools = {};
  const walk = (node: unknown) => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (Array.isArray(value)) pools[key] = value.filter((l): l is string => typeof l === "string" && l.trim() !== "");
      else walk(value);
    }
  };
  walk(json);
  return pools;
}

/** The default pools with the theme's `copy` applied: "replace" swaps a pool, "add" appends to it. */
export function mergePools(defaults: Pools, copy: ThemeFile["copy"]): Pools {
  const out: Pools = {};
  for (const [k, lines] of Object.entries(defaults)) out[k] = [...lines];
  for (const [k, pool] of Object.entries(copy)) {
    out[k] = pool.mode === "replace" ? [...pool.lines] : [...(out[k] ?? []), ...pool.lines];
  }
  return out;
}

const PLACEHOLDER = /\{([a-z]+)\}/g;

/**
 * Fills a line's placeholders, or returns null when the line cannot be used:
 * a placeholder has no value (or is unknown), or it has {n} and n < 2.
 */
export function fillLine(line: string, vars: CopyVars): string | null {
  const values: Record<string, string | number | undefined> = vars;
  let usable = true;
  for (const m of line.matchAll(PLACEHOLDER)) {
    const name = m[1]!;
    // Own properties only (SA-21): {constructor} must not find Object's.
    const v = Object.hasOwn(values, name) ? values[name] : undefined;
    if (v === undefined || v === null || v === "") usable = false;
    if (name === "n" && (typeof v !== "number" || v < 2)) usable = false;
  }
  if (!usable) return null;
  return line.replace(PLACEHOLDER, (_, name: string) => String(values[name]));   // every name was checked above
}

/**
 * The copy picker. `pools()` is read on every pick, so a theme saved during a
 * night takes effect on the next line. `pub` defaults to the venue name.
 */
export function createCopyPicker(pools: () => Pools, venueName: () => string | null, random: () => number = Math.random): CopyPicker {
  return {
    pick(key, vars, last) {
      const lines = pools()[key];
      if (!lines || lines.length === 0) return null;
      const filled: CopyVars = { ...vars };
      if (filled.pub === undefined) filled.pub = venueName() ?? undefined;
      let usable: { text: string; index: number }[] = [];
      lines.forEach((line, index) => {
        const text = fillLine(line, filled);
        if (text !== null) usable.push({ text, index });
      });
      const previous = last[key];
      if (usable.length > 1 && previous !== undefined) usable = usable.filter((u) => u.index !== previous);
      if (usable.length === 0) return null;
      return usable[Math.min(usable.length - 1, Math.floor(random() * usable.length))]!;
    },
  };
}
