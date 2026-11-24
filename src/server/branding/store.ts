// Theme and venue stores (TECH-SPEC 5.3, 5.4). The files in the data folder
// are the source of truth: each read checks the file's modification time, so a
// theme copied in by hand is picked up without a restart (S-09). A file that
// fails validation is reported in the log and the defaults are used; the file
// itself is left alone until the host saves new settings (4.4).

import { existsSync, mkdirSync, statSync, writeFileSync, renameSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultTheme, defaultVenue, validateTheme, validateVenue,
  type Problem, type ThemeFile, type Validated, type VenueFile,
} from "../../shared/formats.ts";
import { writeJsonAtomic } from "../files.ts";
import { assetName, checkAsset, type AssetCheck, type AssetKind } from "./assets.ts";

interface Cached<T> { mtime: number; value: T; version: string; problems: Problem[] }

function hashText(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 12);
}

/** Serialises a file the way writeJsonAtomic writes it, so the version of an unsaved default equals the saved default's. */
function serialise(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export class BrandingStore {
  readonly themePath: string;
  readonly venuePath: string;
  readonly assetsDir: string;
  private themeCache: Cached<ThemeFile> | null = null;
  private venueCache: Cached<VenueFile> | null = null;
  private themeListeners: ((theme: ThemeFile, version: string) => void)[] = [];

  constructor(dataDir: string, private log: (m: string) => void = () => {}) {
    this.themePath = join(dataDir, "theme", "theme.json");
    this.venuePath = join(dataDir, "venue.json");
    this.assetsDir = join(dataDir, "theme", "assets");
  }

  // --- theme --------------------------------------------------------------

  /** The current theme; defaults where the file is missing or invalid. */
  theme(): ThemeFile { return this.loadTheme().value; }
  /** A hash of theme.json; changes whenever the theme changes (views carry it as venue.themeVersion). */
  themeVersion(): string { return this.loadTheme().version; }
  /** Problems found in theme.json on disk (empty when it is fine or missing). */
  themeProblems(): Problem[] { return this.loadTheme().problems; }
  /** The venue name for {pub} and the screens, or null. */
  venueName(): string | null { return this.theme().name; }

  /** Called after every theme save, with the new theme and version. */
  onThemeChange(fn: (theme: ThemeFile, version: string) => void): void { this.themeListeners.push(fn); }

  /**
   * Validates and saves a theme. Every asset it names must exist in
   * theme/assets/, so a theme never points at a missing file.
   */
  saveTheme(json: unknown): Validated<ThemeFile> {
    const v = validateTheme(json);
    if (!v.ok) return v;
    const missing = this.missingAssets(v.value);
    if (missing.length > 0) return { ok: false, problems: missing };
    writeJsonAtomic(this.themePath, v.value);
    this.themeCache = null;
    const version = this.themeVersion();
    for (const fn of this.themeListeners) fn(v.value, version);
    return v;
  }

  private missingAssets(t: ThemeFile): Problem[] {
    const refs: [string, string | undefined][] = [
      ["logo", t.logo ?? undefined],
      ["fonts.display", t.fonts.display && "file" in t.fonts.display ? t.fonts.display.file : undefined],
      ["fonts.body", t.fonts.body && "file" in t.fonts.body ? t.fonts.body.file : undefined],
      ["displayBackground.image", t.displayBackground && "image" in t.displayBackground ? t.displayBackground.image : undefined],
    ];
    const problems: Problem[] = [];
    for (const [path, ref] of refs) {
      if (ref && !this.assetPath(ref.slice("assets/".length))) {
        problems.push({ path, message: "That file has not been uploaded, or it was removed. Upload it again." });
      }
    }
    return problems;
  }

  private loadTheme(): Cached<ThemeFile> {
    const mtime = mtimeOf(this.themePath);
    if (this.themeCache && this.themeCache.mtime === mtime) return this.themeCache;
    this.themeCache = this.read(this.themePath, mtime, "theme", validateTheme, defaultTheme);
    return this.themeCache;
  }

  // --- venue --------------------------------------------------------------

  venue(): VenueFile { return this.loadVenue().value; }
  venueProblems(): Problem[] { return this.loadVenue().problems; }

  /** Validates and saves venue settings. Prizes are stored in place order; two prizes for one place are refused. */
  saveVenue(json: unknown): Validated<VenueFile> {
    const v = validateVenue(json);
    if (!v.ok) return v;
    const places = new Set<number>();
    const problems: Problem[] = [];
    v.value.prizes.forEach((p, i) => {
      if (places.has(p.place)) problems.push({ path: `prizes.${i}.place`, message: `There are two prizes for place ${p.place}.` });
      places.add(p.place);
    });
    if (problems.length > 0) return { ok: false, problems };
    v.value.prizes.sort((a, b) => a.place - b.place);
    writeJsonAtomic(this.venuePath, v.value);
    this.venueCache = null;
    return v;
  }

  private loadVenue(): Cached<VenueFile> {
    const mtime = mtimeOf(this.venuePath);
    if (this.venueCache && this.venueCache.mtime === mtime) return this.venueCache;
    this.venueCache = this.read(this.venuePath, mtime, "venue settings", validateVenue, defaultVenue);
    return this.venueCache;
  }

  // --- assets -------------------------------------------------------------

  /** Checks and stores an uploaded asset under a generated name. Same file, same name. */
  saveAsset(kind: AssetKind, bytes: Uint8Array): AssetCheck & { file?: string } {
    const check = checkAsset(kind, bytes);
    if (!check.ok) return check;
    const name = assetName(kind, check.ext, bytes);
    const path = join(this.assetsDir, name);
    if (!existsSync(path)) {
      mkdirSync(this.assetsDir, { recursive: true });
      writeFileSync(`${path}.tmp`, bytes);
      renameSync(`${path}.tmp`, path);
    }
    return { ...check, file: `assets/${name}` };
  }

  /** The disk path of an asset by its file name, or null if the name is unsafe or the file is missing. */
  assetPath(file: string): string | null {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(file) || file.endsWith(".tmp")) return null;
    const path = join(this.assetsDir, file);
    return existsSync(path) ? path : null;
  }

  // --- shared -------------------------------------------------------------

  private read<T>(path: string, mtime: number, label: string, validate: (j: unknown) => Validated<T>, fallback: () => T): Cached<T> {
    const useDefault = (problems: Problem[]): Cached<T> => {
      const value = fallback();
      return { mtime, value, version: hashText(serialise(value)), problems };
    };
    if (mtime === -1) return useDefault([]);
    let text: string;
    let json: unknown;
    try {
      text = readFileSync(path, "utf8");
      json = JSON.parse(text);
    } catch (e) {
      const problem = { path: "", message: `The ${label} file could not be read: ${e instanceof Error ? e.message : String(e)}` };
      this.log(`${path}: ${problem.message} Using the defaults.`);
      return useDefault([problem]);
    }
    const v = validate(json);
    if (!v.ok) {
      this.log(`${path} has problems, so Lock-In's defaults are used until the ${label} are saved again: ${v.problems.map((p) => `${p.path || "file"}: ${p.message}`).join("; ")}`);
      return useDefault(v.problems);
    }
    return { mtime, value: v.value, version: hashText(text), problems: [] };
  }
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}
