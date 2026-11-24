// Lock-In file formats: quiz, theme and venue files (TECH-SPEC section 5).
// The interfaces are a contract: they change only with Cas's agreement.
// The validators turn untrusted JSON into typed, defaulted values and report
// problems in plain English.

// ---------------------------------------------------------------------------
// 5.2 Quiz file: quizzes/<quizId>/quiz.json
// ---------------------------------------------------------------------------

export interface QuizFile {
  format: "lockin.quiz/1";
  id: string;                      // equals the folder name
  title: string;                   // 1..80 chars
  updatedAt: string;               // ISO 8601, set by the server on every save
  settings: QuizSettings;
  rounds: Round[];                 // 1..20
  suddenDeath: Question[];         // 0..20; answer types "text", "choice" or "closest" only (H-14)
}

export interface QuizSettings {
  lockMode: "question" | "round";              // default "question"
  timerSeconds: number;                        // 10..300, default 60
  halftimeAfterRound: "auto" | "none" | number; // default "auto" = after round ceil(rounds/2); number is 1-based
  joker: boolean;                              // default false
  maxTeams: number;                            // 2..30, default 30
  suddenDeathScope: "first" | "all";           // default "first"
  suddenDeathMax: number;                      // 1..10, default 3
  closestScoring: "closest" | "range";         // default "closest"
}

export interface Round {
  id: string;                      // "r-" + 8 chars [a-z0-9], stable for the quiz's life
  title: string;                   // 0..60 chars
  questions: Question[];           // 1..30
}

export interface Question {
  id: string;                      // "q-" + 8 chars [a-z0-9], stable across reordering
  text: string;                    // 1..300 chars
  note?: string;                   // host-only, 0..300 chars
  timerSeconds?: number;           // 10..300, overrides settings.timerSeconds
  media?: Media;
  answer: AnswerSpec;
}

export type Media =
  | { kind: "image"; file: string; alt?: string };   // file is relative to media/, e.g. "q-ab12cd34.jpg"
  // Launch adds { kind: "audio" | "video"; file: string } (H-24, H-25)

export type AnswerSpec =
  | { type: "text"; accepted: string[] }             // 1+; accepted[0] is the answer shown at reveal
  | { type: "choice"; options: string[]; correct: number }   // 2..6 options; correct is a 0-based index
  | { type: "number"; value: number }
  | { type: "closest"; value: number; range?: number }      // range used when closestScoring = "range"
  | { type: "datetime"; precision: "year" | "date" | "time";
      value: string;                                 // "1969" | "1969-07-20" | "20:17"
      scoring: "exact" | "closest"; range?: number }; // range in years, days or minutes by precision

/**
 * A quiz as the builder edits and saves it (code review LI-009). The file format is the same
 * as QuizFile, but anything a QM fills in later may still be empty: question text "", an
 * accepted answer "", no number yet (null), no choice picked (correct -1), no rounds or
 * questions. An answer type from a newer Lock-In is kept as it is (FutureAnswer), so saving
 * never loses it. Only `validateQuiz` turns a draft into a QuizFile the engine may use.
 */
export interface QuizDraft {
  format: "lockin.quiz/1";
  id: string;
  title: string;
  updatedAt: string;
  settings: QuizSettings;
  rounds: DraftRound[];
  suddenDeath: DraftQuestion[];
}

export interface DraftRound {
  id: string;
  title: string;
  questions: DraftQuestion[];
}

export interface DraftQuestion {
  id: string;
  text: string;                    // may be ""
  note?: string;
  timerSeconds?: number;
  media?: DraftMedia;
  answer: DraftAnswer | FutureAnswer;
}

/** `kind` may be one a newer Lock-In added; readiness accepts only "image". */
export interface DraftMedia { kind: string; file: string; alt?: string }

export type DraftAnswer =
  | { type: "text"; accepted: string[] }                       // may be [] or [""]
  | { type: "choice"; options: string[]; correct: number }     // -1: no option picked yet
  | { type: "number"; value: number | null }                   // null: no number yet
  | { type: "closest"; value: number | null; range?: number }
  | { type: "datetime"; precision: "year" | "date" | "time"; value: string; scoring: "exact" | "closest"; range?: number };   // value may be ""

/** An answer of a type this version does not know, kept unchanged in drafts (S-09). Never ready. */
export interface FutureAnswer { type: string; [field: string]: unknown }

// ---------------------------------------------------------------------------
// 5.3 Theme file: theme/theme.json
// ---------------------------------------------------------------------------

export interface ThemeFile {
  format: "lockin.theme/1";
  name: string | null;                         // venue name, fills {pub}; 1..60 chars
  logo: string | null;                         // "assets/<file>", PNG, SVG or JPEG, <= 2 MB
  colours: {
    background: Hex | null;
    text: Hex | null;
    accent: Hex | null;
    accent2: Hex | null;
  };
  fonts: { display: FontRef | null; body: FontRef | null };
  displayBackground: { colour: Hex } | { image: string } | null;   // image: "assets/<file>", JPEG/PNG/WebP <= 5 MB
  copy: Record<string, { mode: "replace" | "add"; lines: string[] }>;  // key = copy pool key
}
export type Hex = string;                      // "#rrggbb", sRGB
export type FontRef = { bundled: string }      // display: "caveat-brush" (default), "alfa-slab-one", "bebas-neue",
                                               //   "atkinson-hyperlegible"; body: "atkinson-hyperlegible" (default)
                    | { file: string };        // "assets/<file>", WOFF2, WOFF or TTF <= 2 MB

// ---------------------------------------------------------------------------
// 5.4 Venue settings: venue.json
// ---------------------------------------------------------------------------

export interface VenueFile {
  format: "lockin.venue/1";
  prizes: Prize[];                             // default prizes for new nights; default []
  holding: {
    minutesBefore: number;                     // 0..120, default 30
    panels: HoldingPanel[];                    // shown in this order; default all six
  };
  afterWinner: {                               // Quiz End: winner screen, then final standings (T-12)
    mode: "timer" | "host";                    // timer: standings after `seconds`; host: on the host's Next (final.show). Default "timer"
    seconds: number;                           // 5..120, default 15; used in timer mode
  };
}
export interface Prize { place: number; text: string }   // place 1.., text 1..80 chars
export type HoldingPanel = "countdown" | "teams" | "join" | "install" | "animation" | "prizes";

// ---------------------------------------------------------------------------
// Defaults and constants
// ---------------------------------------------------------------------------

export const QUIZ_FORMAT = "lockin.quiz/1";
export const THEME_FORMAT = "lockin.theme/1";
export const VENUE_FORMAT = "lockin.venue/1";

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  lockMode: "question",
  timerSeconds: 60,
  halftimeAfterRound: "auto",
  joker: false,
  maxTeams: 30,
  suddenDeathScope: "first",
  suddenDeathMax: 3,
  closestScoring: "closest",
};

export const HOLDING_PANELS: readonly HoldingPanel[] = ["countdown", "teams", "join", "install", "animation", "prizes"];

/** Bundled font ids (Design, docs/design/branding.md). Display may use any of them. */
export const BUNDLED_FONTS: readonly string[] = ["caveat-brush", "alfa-slab-one", "bebas-neue", "atkinson-hyperlegible"];
/** The only bundled body font (Design, docs/design/branding.md). */
export const BUNDLED_BODY_FONTS: readonly string[] = ["atkinson-hyperlegible"];

export function defaultTheme(): ThemeFile {
  return {
    format: THEME_FORMAT,
    name: null,
    logo: null,
    colours: { background: null, text: null, accent: null, accent2: null },
    fonts: { display: null, body: null },
    displayBackground: null,
    copy: {},
  };
}

export function defaultVenue(): VenueFile {
  return { format: VENUE_FORMAT, prizes: [], holding: { minutesBefore: 30, panels: [...HOLDING_PANELS] }, afterWinner: { mode: "timer", seconds: 15 } };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface Problem { path: string; message: string }
export type Validated<T> = { ok: true; value: T } | { ok: false; problems: Problem[] };
export type QuizValidation = { ok: true; quiz: QuizFile } | { ok: false; problems: Problem[] };

export interface ValidateQuizOptions {
  /** When given, `id` must equal the folder name. */
  folderId?: string;
  /** When given, every media file must exist (readiness, H-01). */
  mediaExists?: (file: string) => boolean;
}

export const ROUND_ID = /^r-[a-z0-9]{8}$/;
export const QUESTION_ID = /^q-[a-z0-9]{8}$/;
export const QUIZ_ID = /^[a-z0-9-]{1,60}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** A media or asset file name inside a quiz's or theme's folder. */
export const MEDIA_FILE = SAFE_FILE;

/**
 * The size limits of a quiz file (section 5.2). Readiness (`validateQuiz`) and the
 * builder's draft check (`checkDraft` in src/server/quizzes/draft.ts) both use these, so
 * a quiz that is ready to play always opens and saves in the builder (code review LI-009).
 * The builder page (public/host/build/) mirrors them in its inputs.
 */
export const QUIZ_LIMITS = {
  titleChars: 80,
  rounds: 20,
  roundTitleChars: 60,
  questionsPerRound: 30,
  suddenDeath: 20,
  textChars: 300,      // question text, host note, image description
  answerChars: 100,    // each accepted answer and each option
  accepted: 50,        // accepted answers per typed question, also when marking adds them
  options: 6,
} as const;
const COPY_KEY = /^[a-z][a-z0-9_]{0,39}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const len = (s: string) => [...s].length;

function oneOf<T extends string>(v: unknown, options: readonly T[]): v is T {
  return typeof v === "string" && (options as readonly string[]).includes(v);
}

const DAY_MS = 86_400_000;

/**
 * Reads a datetime value at a precision (the one parser for readiness, submissions and marking,
 * code review LI-002). Returns its normal form (`YYYY` or `-YYYY`, `YYYY-MM-DD` or `HH:MM`) and an
 * ordinal in the unit used for distance (signed years, days or minutes), or null if it is not a
 * valid value. Lenient with what people type: single-digit month, day and hour ("1969-7-20",
 * "9:05"), and seconds on a time are dropped ("20:17:30" is "20:17"). Years run from -9999 to 9999;
 * dates from 0000-01-01 to 9999-12-31 in the proleptic Gregorian calendar.
 */
export function parseDatetime(precision: "year" | "date" | "time", raw: string): { key: string; ordinal: number } | null {
  const s = raw.trim();
  if (precision === "year") {
    const m = /^(-?)(\d{1,4})$/.exec(s);
    if (!m) return null;
    const y = Number(m[2]) * (m[1] ? -1 : 1);
    return { key: (y < 0 ? "-" : "") + String(Math.abs(y)).padStart(4, "0"), ordinal: y === 0 ? 0 : y };
  }
  if (precision === "date") {
    const m = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    // setUTCFullYear, not Date.UTC: Date.UTC reads years 0 to 99 as 1900 to 1999.
    const date = new Date(0);
    date.setUTCFullYear(y, mo - 1, d);
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    const key = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return { key, ordinal: Math.round(date.getTime() / DAY_MS) };
  }
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]), sec = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 23 || min > 59 || sec > 59) return null;
  return { key: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, ordinal: h * 60 + min };
}

/**
 * Checks a datetime answer's value against its precision, as stored in a quiz or sent by a phone:
 * the canonical shape (`-?Y{1,4}`, `YYYY-MM-DD`, `HH:MM`) and a value parseDatetime accepts,
 * so every valid value can be marked.
 */
export function validDatetime(precision: "year" | "date" | "time", value: string): boolean {
  const shape = precision === "year" ? /^-?\d{1,4}$/ : precision === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{2}:\d{2}$/;
  return shape.test(value) && parseDatetime(precision, value) !== null;
}

/**
 * Validates a quiz file and checks readiness (TECH-SPEC 5.2, H-01).
 * Missing settings take their defaults; anything else wrong is a problem.
 */
export function validateQuiz(json: unknown, opts: ValidateQuizOptions = {}): QuizValidation {
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });

  if (!isObj(json)) return { ok: false, problems: [{ path: "", message: "The quiz file is not a JSON object." }] };

  if (json.format !== QUIZ_FORMAT) {
    add("format", typeof json.format === "string"
      ? `This quiz uses format "${json.format}", which this version of Lock-In cannot read.`
      : "The quiz file has no format line, so it may not be a Lock-In quiz.");
  }

  const id = json.id;
  if (typeof id !== "string" || !QUIZ_ID.test(id)) add("id", "The quiz id must be 1 to 60 lower-case letters, digits or hyphens.");
  else if (opts.folderId !== undefined && id !== opts.folderId) add("id", `The quiz id "${id}" does not match its folder "${opts.folderId}".`);

  const title = json.title;
  if (typeof title !== "string" || title.trim() === "") add("title", "The quiz has no title.");
  else if (len(title) > QUIZ_LIMITS.titleChars) add("title", `The quiz title is longer than ${QUIZ_LIMITS.titleChars} characters.`);

  const updatedAt = json.updatedAt;
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) add("updatedAt", "The quiz's saved time is missing or not a date.");

  const settings = validateSettings(json.settings, add);

  const rounds: Round[] = [];
  const seenIds = new Set<string>();
  if (!Array.isArray(json.rounds) || json.rounds.length === 0) {
    add("rounds", "The quiz has no rounds.");
  } else {
    if (json.rounds.length > QUIZ_LIMITS.rounds) add("rounds", `The quiz has more than ${QUIZ_LIMITS.rounds} rounds.`);
    json.rounds.forEach((r, i) => {
      const round = validateRound(r, i, seenIds, opts, add);
      if (round) rounds.push(round);
    });
  }

  if (typeof settings.halftimeAfterRound === "number" && rounds.length > 0 && settings.halftimeAfterRound > rounds.length) {
    add("settings.halftimeAfterRound", `Halftime is set after round ${settings.halftimeAfterRound}, but the quiz has only ${rounds.length} rounds.`);
  }

  const suddenDeath: Question[] = [];
  if (json.suddenDeath !== undefined) {
    if (!Array.isArray(json.suddenDeath)) add("suddenDeath", "The sudden-death questions must be a list.");
    else {
      if (json.suddenDeath.length > QUIZ_LIMITS.suddenDeath) add("suddenDeath", `The quiz has more than ${QUIZ_LIMITS.suddenDeath} sudden-death questions.`);
      json.suddenDeath.forEach((q, i) => {
        const label = `Sudden-death question ${i + 1}`;
        const question = validateQuestion(q, `suddenDeath.${i}`, label, seenIds, opts, add);
        if (question && !["text", "choice", "closest"].includes(question.answer.type)) {
          add(`suddenDeath.${i}.answer.type`, `${label} must be a typed answer, multiple choice or closest number.`);
        }
        if (question) suddenDeath.push(question);
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    quiz: {
      format: QUIZ_FORMAT,
      id: id as string,
      title: title as string,
      updatedAt: updatedAt as string,
      settings,
      rounds,
      suddenDeath,
    },
  };
}

/** Checks quiz settings; missing ones take the defaults. Shared with the builder's draft check (LI-009). */
export function validateSettings(v: unknown, add: (p: string, m: string) => void): QuizSettings {
  const s: QuizSettings = { ...DEFAULT_QUIZ_SETTINGS };
  if (v === undefined) return s;
  if (!isObj(v)) { add("settings", "The quiz settings are not a JSON object."); return s; }
  const p = (k: string) => `settings.${k}`;

  if (v.lockMode !== undefined) {
    if (oneOf(v.lockMode, ["question", "round"] as const)) s.lockMode = v.lockMode;
    else add(p("lockMode"), 'Lock mode must be "question" or "round".');
  }
  if (v.timerSeconds !== undefined) {
    if (isInt(v.timerSeconds) && v.timerSeconds >= 10 && v.timerSeconds <= 300) s.timerSeconds = v.timerSeconds;
    else add(p("timerSeconds"), "The timer must be a whole number of seconds from 10 to 300.");
  }
  if (v.halftimeAfterRound !== undefined) {
    const h = v.halftimeAfterRound;
    if (h === "auto" || h === "none") s.halftimeAfterRound = h;
    else if (isInt(h) && h >= 1 && h <= 20) s.halftimeAfterRound = h;
    else add(p("halftimeAfterRound"), 'Halftime must be "auto", "none" or a round number.');
  }
  if (v.joker !== undefined) {
    if (typeof v.joker === "boolean") s.joker = v.joker;
    else add(p("joker"), "The joker setting must be on or off (true or false).");
  }
  if (v.maxTeams !== undefined) {
    if (isInt(v.maxTeams) && v.maxTeams >= 2 && v.maxTeams <= 30) s.maxTeams = v.maxTeams;
    else add(p("maxTeams"), "The team limit must be a whole number from 2 to 30.");
  }
  if (v.suddenDeathScope !== undefined) {
    if (oneOf(v.suddenDeathScope, ["first", "all"] as const)) s.suddenDeathScope = v.suddenDeathScope;
    else add(p("suddenDeathScope"), 'Sudden death must apply to "first" place or "all" places.');
  }
  if (v.suddenDeathMax !== undefined) {
    if (isInt(v.suddenDeathMax) && v.suddenDeathMax >= 1 && v.suddenDeathMax <= 10) s.suddenDeathMax = v.suddenDeathMax;
    else add(p("suddenDeathMax"), "The most sudden-death questions per place must be a whole number from 1 to 10.");
  }
  if (v.closestScoring !== undefined) {
    if (oneOf(v.closestScoring, ["closest", "range"] as const)) s.closestScoring = v.closestScoring;
    else add(p("closestScoring"), 'Closest-number scoring must be "closest" or "range".');
  }
  return s;
}

function validateRound(v: unknown, i: number, seen: Set<string>, opts: ValidateQuizOptions,
                       add: (p: string, m: string) => void): Round | null {
  const path = `rounds.${i}`;
  const label = `Round ${i + 1}`;
  if (!isObj(v)) { add(path, `${label} is not a JSON object.`); return null; }
  let ok = true;
  if (typeof v.id !== "string" || !ROUND_ID.test(v.id)) { add(`${path}.id`, `${label} has a missing or malformed id.`); ok = false; }
  else if (seen.has(v.id)) { add(`${path}.id`, `${label} has the same id as another round or question.`); ok = false; }
  else seen.add(v.id);

  const title = v.title === undefined ? "" : v.title;
  if (typeof title !== "string") { add(`${path}.title`, `${label}'s title must be text.`); ok = false; }
  else if (len(title) > QUIZ_LIMITS.roundTitleChars) { add(`${path}.title`, `${label}'s title is longer than ${QUIZ_LIMITS.roundTitleChars} characters.`); ok = false; }

  const questions: Question[] = [];
  if (!Array.isArray(v.questions) || v.questions.length === 0) { add(`${path}.questions`, `${label} has no questions.`); ok = false; }
  else {
    if (v.questions.length > QUIZ_LIMITS.questionsPerRound) { add(`${path}.questions`, `${label} has more than ${QUIZ_LIMITS.questionsPerRound} questions.`); ok = false; }
    v.questions.forEach((q, j) => {
      const question = validateQuestion(q, `${path}.questions.${j}`, `${label}, question ${j + 1}`, seen, opts, add);
      if (question) questions.push(question); else ok = false;
    });
  }
  return ok ? { id: v.id as string, title: title as string, questions } : null;
}

function validateQuestion(v: unknown, path: string, label: string, seen: Set<string>, opts: ValidateQuizOptions,
                          add: (p: string, m: string) => void): Question | null {
  if (!isObj(v)) { add(path, `${label} is not a JSON object.`); return null; }
  const before = { count: 0 };
  const err = (p: string, m: string) => { before.count++; add(p, m); };

  if (typeof v.id !== "string" || !QUESTION_ID.test(v.id)) err(`${path}.id`, `${label} has a missing or malformed id.`);
  else if (seen.has(v.id)) err(`${path}.id`, `${label} has the same id as another question.`);
  else seen.add(v.id);

  if (typeof v.text !== "string" || v.text.trim() === "") err(`${path}.text`, `${label} has no question text.`);
  else if (len(v.text) > QUIZ_LIMITS.textChars) err(`${path}.text`, `${label}'s text is longer than ${QUIZ_LIMITS.textChars} characters.`);

  if (v.note !== undefined && (typeof v.note !== "string" || len(v.note) > 300)) err(`${path}.note`, `${label}'s host note must be text of at most 300 characters.`);

  if (v.timerSeconds !== undefined && !(isInt(v.timerSeconds) && v.timerSeconds >= 10 && v.timerSeconds <= 300)) {
    err(`${path}.timerSeconds`, `${label}'s timer must be a whole number of seconds from 10 to 300.`);
  }

  let media: Media | undefined;
  if (v.media !== undefined) {
    const m = v.media;
    if (!isObj(m)) err(`${path}.media`, `${label}'s media is not a JSON object.`);
    else if (m.kind !== "image") err(`${path}.media.kind`, `${label} uses media of kind "${String(m.kind)}", which this version of Lock-In cannot show.`);
    else if (typeof m.file !== "string" || !SAFE_FILE.test(m.file)) err(`${path}.media.file`, `${label}'s image file name is missing or not allowed.`);
    else if (m.alt !== undefined && (typeof m.alt !== "string" || len(m.alt) > 300)) err(`${path}.media.alt`, `${label}'s image description must be text of at most 300 characters.`);
    else if (opts.mediaExists && !opts.mediaExists(m.file)) err(`${path}.media.file`, `${label}'s image "${m.file}" is missing from the quiz's media folder.`);
    else media = m.alt === undefined ? { kind: "image", file: m.file } : { kind: "image", file: m.file, alt: m.alt as string };
  }

  const answer = validateAnswer(v.answer, `${path}.answer`, label, err);

  if (before.count > 0 || !answer) return null;
  const q: Question = { id: v.id as string, text: v.text as string, answer };
  if (v.note !== undefined) q.note = v.note as string;
  if (v.timerSeconds !== undefined) q.timerSeconds = v.timerSeconds as number;
  if (media) q.media = media;
  return q;
}

function validateRange(v: unknown, path: string, label: string, err: (p: string, m: string) => void): number | undefined | null {
  if (v === undefined) return undefined;
  if (isNum(v) && v >= 0) return v;
  err(`${path}.range`, `${label}'s range must be a number of 0 or more.`);
  return null;
}

function validateAnswer(v: unknown, path: string, label: string, err: (p: string, m: string) => void): AnswerSpec | null {
  if (v === undefined || v === null) { err(path, `${label} has no answer.`); return null; }
  if (!isObj(v)) { err(path, `${label}'s answer is not a JSON object.`); return null; }
  switch (v.type) {
    case "text": {
      const acc = v.accepted;
      if (!Array.isArray(acc) || acc.length === 0 || acc.every((a) => typeof a === "string" && a.trim() === "")) {
        err(`${path}.accepted`, `${label} has no answer.`); return null;
      }
      if (acc.length > QUIZ_LIMITS.accepted) {
        err(`${path}.accepted`, `${label} has more than ${QUIZ_LIMITS.accepted} accepted answers.`); return null;
      }
      if (!acc.every((a) => typeof a === "string" && a.trim() !== "" && len(a) <= QUIZ_LIMITS.answerChars)) {
        err(`${path}.accepted`, `${label} has an accepted answer that is empty or longer than ${QUIZ_LIMITS.answerChars} characters.`); return null;
      }
      return { type: "text", accepted: acc as string[] };
    }
    case "choice": {
      const opts = v.options;
      if (!Array.isArray(opts) || opts.length < 2 || opts.length > QUIZ_LIMITS.options) {
        err(`${path}.options`, `${label} needs 2 to ${QUIZ_LIMITS.options} options.`); return null;
      }
      if (!opts.every((o) => typeof o === "string" && o.trim() !== "" && len(o) <= QUIZ_LIMITS.answerChars)) {
        err(`${path}.options`, `${label} has an option that is empty or longer than ${QUIZ_LIMITS.answerChars} characters.`); return null;
      }
      if (!isInt(v.correct) || v.correct < 0 || v.correct >= opts.length) {
        err(`${path}.correct`, `${label} has no correct option picked.`); return null;
      }
      return { type: "choice", options: opts as string[], correct: v.correct };
    }
    case "number": {
      if (!isNum(v.value)) { err(`${path}.value`, `${label} has no answer.`); return null; }
      return { type: "number", value: v.value };
    }
    case "closest": {
      if (!isNum(v.value)) { err(`${path}.value`, `${label} has no answer.`); return null; }
      const range = validateRange(v.range, path, label, err);
      if (range === null) return null;
      return range === undefined ? { type: "closest", value: v.value } : { type: "closest", value: v.value, range };
    }
    case "datetime": {
      if (!oneOf(v.precision, ["year", "date", "time"] as const)) {
        err(`${path}.precision`, `${label} must say whether the answer is a year, a date or a time.`); return null;
      }
      if (typeof v.value !== "string" || !validDatetime(v.precision, v.value)) {
        const shape = { year: "a year like 1969", date: "a date like 1969-07-20", time: "a time like 20:17" }[v.precision];
        err(`${path}.value`, `${label}'s answer must be ${shape}.`); return null;
      }
      if (!oneOf(v.scoring, ["exact", "closest"] as const)) {
        err(`${path}.scoring`, `${label} must be scored "exact" or "closest".`); return null;
      }
      const range = validateRange(v.range, path, label, err);
      if (range === null) return null;
      const spec: AnswerSpec = { type: "datetime", precision: v.precision, value: v.value, scoring: v.scoring };
      if (range !== undefined) spec.range = range;
      return spec;
    }
    default:
      err(`${path}.type`, typeof v.type === "string"
        ? `${label} uses answer type "${v.type}", which this version of Lock-In cannot mark.`
        : `${label} has no answer type.`);
      return null;
  }
}

function assetPath(v: unknown, exts: string[]): boolean {
  if (typeof v !== "string") return false;
  const m = /^assets\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})$/.exec(v);
  if (!m) return false;
  const ext = m[1]!.toLowerCase().split(".").pop() ?? "";
  return exts.includes(ext);
}

function validateFont(v: unknown, path: string, label: "display" | "body", add: (p: string, m: string) => void): FontRef | null | undefined {
  if (v === null || v === undefined) return null;
  if (isObj(v) && typeof v.bundled === "string") {
    const allowed = label === "body" ? BUNDLED_BODY_FONTS : BUNDLED_FONTS;
    if (allowed.includes(v.bundled)) return { bundled: v.bundled };
    add(path, label === "body" && BUNDLED_FONTS.includes(v.bundled)
      ? `"${v.bundled}" is a headline font. The body font must be Atkinson Hyperlegible or an uploaded font.`
      : `The ${label} font "${v.bundled}" is not one of Lock-In's bundled fonts.`);
    return undefined;
  }
  if (isObj(v) && v.file !== undefined) {
    if (assetPath(v.file, ["woff2", "woff", "ttf"])) return { file: v.file as string };
    add(path, `The ${label} font file must be a WOFF2, WOFF or TTF file in the theme's assets folder.`);
    return undefined;
  }
  add(path, `The ${label} font must be a bundled font or an uploaded font file.`);
  return undefined;
}

/** Validates a theme file (TECH-SPEC 5.3). Missing fields mean "use the default". */
export function validateTheme(json: unknown): Validated<ThemeFile> {
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  if (!isObj(json)) return { ok: false, problems: [{ path: "", message: "The theme file is not a JSON object." }] };

  const t = defaultTheme();
  if (json.format !== THEME_FORMAT) {
    add("format", typeof json.format === "string"
      ? `This theme uses format "${json.format}", which this version of Lock-In cannot read.`
      : "The theme file has no format line, so it may not be a Lock-In theme.");
  }

  if (json.name !== undefined && json.name !== null) {
    if (typeof json.name === "string" && json.name.trim() !== "" && len(json.name) <= 60) t.name = json.name;
    else add("name", "The venue name must be 1 to 60 characters.");
  }

  if (json.logo !== undefined && json.logo !== null) {
    if (assetPath(json.logo, ["png", "svg", "jpg", "jpeg"])) t.logo = json.logo as string;
    else add("logo", "The logo must be a PNG, SVG or JPEG file in the theme's assets folder.");
  }

  if (json.colours !== undefined && json.colours !== null) {
    if (!isObj(json.colours)) add("colours", "The colours are not a JSON object.");
    else {
      const names = { background: "background", text: "text", accent: "main", accent2: "second" } as const;
      for (const key of Object.keys(names) as (keyof typeof names)[]) {
        const c = json.colours[key];
        if (c === undefined || c === null) continue;
        if (typeof c === "string" && HEX.test(c)) t.colours[key] = c.toLowerCase();
        else add(`colours.${key}`, `The ${names[key]} colour must be a colour code like #1a2b3c.`);
      }
    }
  }

  if (json.fonts !== undefined && json.fonts !== null) {
    if (!isObj(json.fonts)) add("fonts", "The fonts are not a JSON object.");
    else {
      const d = validateFont(json.fonts.display, "fonts.display", "display", add);
      if (d !== undefined) t.fonts.display = d;
      const b = validateFont(json.fonts.body, "fonts.body", "body", add);
      if (b !== undefined) t.fonts.body = b;
    }
  }

  if (json.displayBackground !== undefined && json.displayBackground !== null) {
    const bg = json.displayBackground;
    if (isObj(bg) && bg.colour !== undefined) {
      if (typeof bg.colour === "string" && HEX.test(bg.colour)) t.displayBackground = { colour: bg.colour.toLowerCase() };
      else add("displayBackground.colour", "The display background colour must be a colour code like #1a2b3c.");
    } else if (isObj(bg) && bg.image !== undefined) {
      if (assetPath(bg.image, ["jpg", "jpeg", "png", "webp"])) t.displayBackground = { image: bg.image as string };
      else add("displayBackground.image", "The display background picture must be a JPEG, PNG or WebP file in the theme's assets folder.");
    } else add("displayBackground", "The display background must be a colour or a picture.");
  }

  if (json.copy !== undefined && json.copy !== null) {
    if (!isObj(json.copy)) add("copy", "The copy lines are not a JSON object.");
    else {
      for (const [key, pool] of Object.entries(json.copy)) {
        const p = `copy.${key}`;
        if (!COPY_KEY.test(key)) { add(p, `"${key}" is not a copy pool name.`); continue; }
        if (!isObj(pool) || !oneOf(pool.mode, ["replace", "add"] as const)) { add(p, `The "${key}" lines must say whether they replace or add to the default lines.`); continue; }
        const lines = pool.lines;
        if (!Array.isArray(lines) || lines.length > 50 || !lines.every((l) => typeof l === "string" && l.trim() !== "" && len(l) <= 200)) {
          add(`${p}.lines`, `The "${key}" lines must be up to 50 lines of 1 to 200 characters.`);
          continue;
        }
        t.copy[key] = { mode: pool.mode, lines: lines as string[] };
      }
    }
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: t };
}

/** Validates a venue file (TECH-SPEC 5.4). Unknown holding panels are ignored. */
export function validateVenue(json: unknown): Validated<VenueFile> {
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  if (!isObj(json)) return { ok: false, problems: [{ path: "", message: "The venue file is not a JSON object." }] };

  const v = defaultVenue();
  if (json.format !== VENUE_FORMAT) {
    add("format", typeof json.format === "string"
      ? `This venue file uses format "${json.format}", which this version of Lock-In cannot read.`
      : "The venue file has no format line, so it may not be a Lock-In venue file.");
  }

  if (json.prizes !== undefined) {
    if (!Array.isArray(json.prizes)) add("prizes", "The prizes must be a list.");
    else {
      v.prizes = [];
      json.prizes.forEach((p, i) => {
        if (!isObj(p) || !isInt(p.place) || p.place < 1) { add(`prizes.${i}.place`, `Prize ${i + 1} needs a place of 1 or more.`); return; }
        if (typeof p.text !== "string" || p.text.trim() === "" || len(p.text) > 80) { add(`prizes.${i}.text`, `The prize for place ${p.place} must be 1 to 80 characters.`); return; }
        v.prizes.push({ place: p.place, text: p.text });
      });
    }
  }

  if (json.holding !== undefined) {
    const h = json.holding;
    if (!isObj(h)) add("holding", "The holding page settings are not a JSON object.");
    else {
      if (h.minutesBefore !== undefined) {
        if (isInt(h.minutesBefore) && h.minutesBefore >= 0 && h.minutesBefore <= 120) v.holding.minutesBefore = h.minutesBefore;
        else add("holding.minutesBefore", "The holding page must start 0 to 120 minutes before the quiz.");
      }
      if (h.panels !== undefined) {
        if (!Array.isArray(h.panels)) add("holding.panels", "The holding page panels must be a list.");
        else {
          const panels: HoldingPanel[] = [];
          for (const p of h.panels) if (oneOf(p, HOLDING_PANELS) && !panels.includes(p)) panels.push(p);
          v.holding.panels = panels;
        }
      }
    }
  }

  if (json.afterWinner !== undefined) {
    const w = json.afterWinner;
    if (!isObj(w)) add("afterWinner", "The after-the-winner setting is not a JSON object.");
    else {
      if (w.mode !== undefined) {
        if (w.mode === "timer" || w.mode === "host") v.afterWinner.mode = w.mode;
        else add("afterWinner.mode", "After the winner, the standings show on a timer or when the host presses Next.");
      }
      if (w.seconds !== undefined) {
        if (isInt(w.seconds) && w.seconds >= 5 && w.seconds <= 120) v.afterWinner.seconds = w.seconds;
        else add("afterWinner.seconds", "The winner screen must show for 5 to 120 seconds.");
      }
    }
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: v };
}
