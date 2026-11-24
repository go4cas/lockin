// Draft checks for the quiz builder (B3).
//
// The builder autosaves while the QM types, so a saved quiz is often not
// ready yet: questions without text or answers, rounds without questions.
// `validateQuiz` (B0, formats.ts) decides readiness (H-01). This file decides
// whether a draft may be *saved*: the shape and limits of TECH-SPEC 5.2 must
// hold, but anything a QM fills in later may still be empty. It also writes
// every object in the format's field order, so files diff cleanly (5.1).

import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type Problem, type QuizFile, type QuizSettings } from "../../shared/formats.ts";

export const ROUND_ID = /^r-[a-z0-9]{8}$/;
export const QUESTION_ID = /^q-[a-z0-9]{8}$/;
export const QUIZ_ID = /^[a-z0-9-]{1,60}$/;
export const MEDIA_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const len = (s: string) => [...s].length;
const str = (v: unknown, max: number): v is string => typeof v === "string" && len(v) <= max;

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newId(prefix: "r-" | "q-"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = prefix;
  for (const b of bytes) s += ID_CHARS[b % ID_CHARS.length];
  return s;
}

/** An empty question, as the default shape and the builder's "Add question" make it. */
export function emptyQuestion(): Obj {
  return { id: newId("q-"), text: "", answer: { type: "text", accepted: [""] } };
}

/** A new quiz: 6 rounds of 5 empty questions and default settings (H-02). */
export function newQuiz(id: string, title: string, updatedAt: string): QuizFile {
  const rounds = Array.from({ length: 6 }, () => ({
    id: newId("r-"),
    title: "",
    questions: Array.from({ length: 5 }, emptyQuestion),
  }));
  return { format: QUIZ_FORMAT, id, title, updatedAt, settings: { ...DEFAULT_QUIZ_SETTINGS }, rounds, suddenDeath: [] } as unknown as QuizFile;
}

/**
 * Checks a draft quiz from the builder and returns it rebuilt in field order,
 * or the problems that stop it being saved. `id` and `updatedAt` are not
 * checked here: the server sets them.
 */
export function checkDraft(v: unknown): { ok: true; quiz: Obj } | { ok: false; problems: Problem[] } {
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  if (!isObj(v)) return { ok: false, problems: [{ path: "", message: "The quiz is not a JSON object." }] };

  if (v.format !== QUIZ_FORMAT) add("format", `The quiz must use format "${QUIZ_FORMAT}".`);
  const title = typeof v.title === "string" ? v.title.trim() : "";
  if (title === "") add("title", "The quiz needs a title.");
  else if (len(title) > 80) add("title", "The quiz title can be at most 80 characters.");

  const settings = checkSettings(v.settings, add);
  const seen = new Set<string>();

  const rounds: Obj[] = [];
  if (!Array.isArray(v.rounds)) add("rounds", "The rounds must be a list.");
  else if (v.rounds.length > 20) add("rounds", "A quiz can have at most 20 rounds.");
  else v.rounds.forEach((r, i) => {
    const path = `rounds.${i}`;
    const label = `Round ${i + 1}`;
    if (!isObj(r)) { add(path, `${label} is not a JSON object.`); return; }
    if (typeof r.id !== "string" || !ROUND_ID.test(r.id) || seen.has(r.id)) add(`${path}.id`, `${label} has a missing, malformed or repeated id.`);
    else seen.add(r.id);
    const rt = r.title === undefined ? "" : r.title;
    if (!str(rt, 60)) add(`${path}.title`, `${label}'s title can be at most 60 characters.`);
    const questions: Obj[] = [];
    if (!Array.isArray(r.questions)) add(`${path}.questions`, `${label}'s questions must be a list.`);
    else if (r.questions.length > 30) add(`${path}.questions`, `${label} can have at most 30 questions.`);
    else r.questions.forEach((q, j) => {
      const out = checkQuestion(q, `${path}.questions.${j}`, `${label}, question ${j + 1}`, seen, add);
      if (out) questions.push(out);
    });
    rounds.push({ id: r.id, title: rt, questions });
  });

  const suddenDeath: Obj[] = [];
  const sd = v.suddenDeath === undefined ? [] : v.suddenDeath;
  if (!Array.isArray(sd)) add("suddenDeath", "The sudden-death questions must be a list.");
  else if (sd.length > 20) add("suddenDeath", "A quiz can have at most 20 sudden-death questions.");
  else sd.forEach((q, i) => {
    const out = checkQuestion(q, `suddenDeath.${i}`, `Sudden-death question ${i + 1}`, seen, add);
    if (out) suddenDeath.push(out);
  });

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, quiz: { format: QUIZ_FORMAT, id: "", title, updatedAt: "", settings, rounds, suddenDeath } };
}

function checkSettings(v: unknown, add: (p: string, m: string) => void): QuizSettings {
  const s: QuizSettings = { ...DEFAULT_QUIZ_SETTINGS };
  if (v === undefined) return s;
  if (!isObj(v)) { add("settings", "The quiz settings are not a JSON object."); return s; }
  const bad = (k: string, m: string) => add(`settings.${k}`, m);
  if (v.lockMode !== undefined) {
    if (v.lockMode === "question" || v.lockMode === "round") s.lockMode = v.lockMode;
    else bad("lockMode", 'Lock mode must be "question" or "round".');
  }
  if (v.timerSeconds !== undefined) {
    if (isInt(v.timerSeconds) && v.timerSeconds >= 10 && v.timerSeconds <= 300) s.timerSeconds = v.timerSeconds;
    else bad("timerSeconds", "The timer must be a whole number of seconds from 10 to 300.");
  }
  if (v.halftimeAfterRound !== undefined) {
    const h = v.halftimeAfterRound;
    if (h === "auto" || h === "none" || (isInt(h) && h >= 1 && h <= 20)) s.halftimeAfterRound = h;
    else bad("halftimeAfterRound", 'Halftime must be "auto", "none" or a round number.');
  }
  if (v.joker !== undefined) {
    if (typeof v.joker === "boolean") s.joker = v.joker;
    else bad("joker", "The joker setting must be on or off.");
  }
  if (v.maxTeams !== undefined) {
    if (isInt(v.maxTeams) && v.maxTeams >= 2 && v.maxTeams <= 30) s.maxTeams = v.maxTeams;
    else bad("maxTeams", "The team limit must be a whole number from 2 to 30.");
  }
  if (v.suddenDeathScope !== undefined) {
    if (v.suddenDeathScope === "first" || v.suddenDeathScope === "all") s.suddenDeathScope = v.suddenDeathScope;
    else bad("suddenDeathScope", 'Sudden death must apply to "first" place or "all" places.');
  }
  if (v.suddenDeathMax !== undefined) {
    if (isInt(v.suddenDeathMax) && v.suddenDeathMax >= 1 && v.suddenDeathMax <= 10) s.suddenDeathMax = v.suddenDeathMax;
    else bad("suddenDeathMax", "The most sudden-death questions per place must be a whole number from 1 to 10.");
  }
  if (v.closestScoring !== undefined) {
    if (v.closestScoring === "closest" || v.closestScoring === "range") s.closestScoring = v.closestScoring;
    else bad("closestScoring", 'Closest-number scoring must be "closest" or "range".');
  }
  // Field order of QuizSettings in formats.ts
  return {
    lockMode: s.lockMode, timerSeconds: s.timerSeconds, halftimeAfterRound: s.halftimeAfterRound, joker: s.joker,
    maxTeams: s.maxTeams, suddenDeathScope: s.suddenDeathScope, suddenDeathMax: s.suddenDeathMax, closestScoring: s.closestScoring,
  };
}

function checkQuestion(q: unknown, path: string, label: string, seen: Set<string>, add: (p: string, m: string) => void): Obj | null {
  if (!isObj(q)) { add(path, `${label} is not a JSON object.`); return null; }
  let ok = true;
  const bad = (p: string, m: string) => { ok = false; add(`${path}${p}`, m); };
  if (typeof q.id !== "string" || !QUESTION_ID.test(q.id) || seen.has(q.id)) bad(".id", `${label} has a missing, malformed or repeated id.`);
  else seen.add(q.id);
  const text = q.text === undefined ? "" : q.text;
  if (!str(text, 300)) bad(".text", `${label}'s text can be at most 300 characters.`);
  if (q.note !== undefined && !str(q.note, 300)) bad(".note", `${label}'s host note can be at most 300 characters.`);
  if (q.timerSeconds !== undefined && !(isInt(q.timerSeconds) && q.timerSeconds >= 10 && q.timerSeconds <= 300)) {
    bad(".timerSeconds", `${label}'s timer must be a whole number of seconds from 10 to 300.`);
  }
  let media: Obj | undefined;
  if (q.media !== undefined) {
    const m = q.media;
    if (!isObj(m) || typeof m.kind !== "string" || len(m.kind) > 20) bad(".media", `${label}'s media is not valid.`);
    else if (typeof m.file !== "string" || !MEDIA_FILE.test(m.file)) bad(".media.file", `${label}'s media file name is missing or not allowed.`);
    else if (m.alt !== undefined && !str(m.alt, 300)) bad(".media.alt", `${label}'s image description can be at most 300 characters.`);
    else media = m.alt === undefined ? { kind: m.kind, file: m.file } : { kind: m.kind, file: m.file, alt: m.alt };
  }
  const answer = checkAnswer(q.answer, label, (p, m) => bad(`.answer${p}`, m));
  if (!ok) return null;
  const out: Obj = { id: q.id, text };
  if (q.note !== undefined) out.note = q.note;
  if (q.timerSeconds !== undefined) out.timerSeconds = q.timerSeconds;
  if (media) out.media = media;
  out.answer = answer;
  return out;
}

const optRange = (v: unknown) => v === undefined || (isNum(v) && v >= 0);

/** Answers may be incomplete in a draft (empty text, no value yet); types and sizes must hold. */
function checkAnswer(a: unknown, label: string, bad: (p: string, m: string) => void): Obj | null {
  if (!isObj(a) || typeof a.type !== "string") { bad("", `${label} has no answer type.`); return null; }
  switch (a.type) {
    case "text": {
      const acc = a.accepted;
      if (!Array.isArray(acc) || acc.length > 50 || !acc.every((x) => str(x, 100))) {
        bad(".accepted", `${label}'s accepted answers must be a list of at most 50, each at most 100 characters.`); return null;
      }
      return { type: "text", accepted: acc };
    }
    case "choice": {
      const opts = a.options;
      if (!Array.isArray(opts) || opts.length > 6 || !opts.every((x) => str(x, 100))) {
        bad(".options", `${label} can have at most 6 options, each at most 100 characters.`); return null;
      }
      if (!isInt(a.correct) || a.correct < -1 || a.correct > 5) { bad(".correct", `${label}'s correct option is not valid.`); return null; }
      return { type: "choice", options: opts, correct: a.correct };
    }
    case "number":
    case "closest": {
      if (a.value !== null && !isNum(a.value)) { bad(".value", `${label}'s answer must be a number.`); return null; }
      if (a.type === "number") return { type: "number", value: a.value };
      if (!optRange(a.range)) { bad(".range", `${label}'s range must be a number of 0 or more.`); return null; }
      return a.range === undefined ? { type: "closest", value: a.value } : { type: "closest", value: a.value, range: a.range };
    }
    case "datetime": {
      if (a.precision !== "year" && a.precision !== "date" && a.precision !== "time") { bad(".precision", `${label} must say year, date or time.`); return null; }
      if (!str(a.value, 12)) { bad(".value", `${label}'s answer is too long.`); return null; }
      if (a.scoring !== "exact" && a.scoring !== "closest") { bad(".scoring", `${label} must be scored "exact" or "closest".`); return null; }
      if (!optRange(a.range)) { bad(".range", `${label}'s range must be a number of 0 or more.`); return null; }
      const out: Obj = { type: "datetime", precision: a.precision, value: a.value, scoring: a.scoring };
      if (a.range !== undefined) out.range = a.range;
      return out;
    }
    default:
      // A type from a newer Lock-In: keep it as it is, so saving never loses it (S-09). It stays "not ready".
      if (len(a.type) > 20) { bad(".type", `${label}'s answer type is not valid.`); return null; }
      return a;
  }
}
