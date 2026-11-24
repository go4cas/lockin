// The composition root's services (code review LI-020). Every store and pure service the
// modules need is built here, once per app, before any module registers. A module receives
// what it uses through app.services; nothing is optional, nothing is looked up by probing a
// module's exports, and nothing lives in a module-global variable, so two apps in one process
// never share a data folder.

import type { Database } from "bun:sqlite";
import { join } from "node:path";
import type { CopyPicker, Rules } from "../shared/rules-api.ts";
import type { Clock } from "./auth.ts";
import { createCopyPicker, mergePools, poolsFromCopyFile, type Pools } from "./branding/copy.ts";
import { BrandingStore } from "./branding/store.ts";
import { DisplayPairing } from "./display/pairing.ts";
import { QuizStore } from "./quizzes/store.ts";
import { rules as defaultRules } from "./rules/index.ts";
import type { FileSource } from "./static.ts";

/** The default copy pools, a shipped file (embedded in the binary, TECH-SPEC 4.6). */
export const COPY_PATH = "assets/copy.en.json";

/** What a module may use of the quiz library: B1 appends answers accepted while marking (TECH-SPEC 5.2). */
export interface AcceptedAnswers {
  saveAcceptedAnswer(quizId: string, questionId: string, text: string): void | Promise<void>;
}

/** Services one module offers another. All are required and built by createServices(). */
export interface Services {
  /** B2: marking, scoring and positions (TECH-SPEC 8). */
  readonly rules: Rules;
  /** B4: copy lines (TECH-SPEC 8.6): the shipped pools with the theme's copy applied. */
  readonly copyPicker: CopyPicker;
  /** B4: theme and venue files (TECH-SPEC 5.3, 5.4). */
  readonly branding: BrandingStore;
  /** B3: the quiz library (TECH-SPEC 5.2). */
  readonly quizStore: QuizStore;
  /** Display pairing (REVIEW finding 4, D2, SA-11). */
  readonly displayPairing: DisplayPairing;
}

/** Test doubles for the pure services; stores always come from the app's own data folder. */
export type ServiceOverrides = Partial<Pick<Services, "rules" | "copyPicker">>;

export interface ServiceDeps {
  dataDir: string;
  db: Database;
  clock: Clock;
  files: FileSource;
  log: (message: string) => void;
}

/**
 * Builds every service for one app. `ready` settles once the shipped copy pools are read
 * (through `files`, so the compiled binary finds its embedded copy); until then the picker
 * uses the theme's own lines only.
 */
export function createServices(deps: ServiceDeps, overrides: ServiceOverrides = {}): { services: Services; ready: Promise<void> } {
  const branding = new BrandingStore(deps.dataDir, deps.log);

  let defaults: Pools = {};
  const ready = deps.files.read(COPY_PATH).then((bytes) => {
    if (!bytes) { deps.log(`${COPY_PATH} is missing, so screens show no copy lines.`); return; }
    try {
      defaults = poolsFromCopyFile(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (e) {
      deps.log(`${COPY_PATH} could not be read, so screens show no copy lines: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  const copyPicker = overrides.copyPicker ?? createCopyPicker(() => mergePools(defaults, branding.theme().copy), () => branding.venueName());

  const inUse = deps.db.query<{ one: number }, [string]>("SELECT 1 AS one FROM nights WHERE quiz_id = ? AND status = 'open' LIMIT 1");
  const quizStore = new QuizStore({
    dir: join(deps.dataDir, "quizzes"),
    now: () => deps.clock.now(),
    inUse: (id) => inUse.get(id) !== null,
    log: deps.log,
  });

  const services: Services = {
    rules: overrides.rules ?? defaultRules,
    copyPicker,
    branding,
    quizStore,
    displayPairing: new DisplayPairing(deps.dataDir, deps.clock, deps.log),
  };
  return { services, ready };
}
