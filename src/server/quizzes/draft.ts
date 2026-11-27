// Draft checks for the quiz builder (B3).
//
// The builder autosaves while the QM types, so a saved quiz is often not
// ready yet: questions without text or answers, rounds without questions.
// `validateQuiz` (B0, formats.ts) decides readiness (H-01). This file decides
// whether a draft may be *saved*: the shape and limits of TECH-SPEC 5.2 must
// hold, but anything a QM fills in later may still be empty. It also writes
// every object in the format's field order, so files diff cleanly (5.1).

import {
  MEDIA_FILE, QUESTION_ID, QUIZ_FORMAT, QUIZ_LIMITS, ROUND_ID, defaultQuizDefaults, validateSettings,
  type DraftAnswer, type DraftMedia, type DraftQuestion, type DraftRound, type FutureAnswer, type Problem, type QuizDefaults, type QuizDraft, type QuizSettings,
} from "../../shared/formats.ts";

// The ids, file names, limits and settings rules are the ones readiness uses (LI-009).
export { MEDIA_FILE, QUESTION_ID, QUIZ_ID, ROUND_ID } from "../../shared/formats.ts";
const L = QUIZ_LIMITS;

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
export function emptyQuestion(): DraftQuestion {
  return { id: newId("q-"), text: "", answer: { type: "text", accepted: [""] } };
}

/** A new quiz: the venue's quiz defaults, else 6 rounds of 5 empty questions and default settings (H-02, UI-33). */
export function newQuiz(id: string, title: string, updatedAt: string, defaults: QuizDefaults = defaultQuizDefaults()): QuizDraft {
  const rounds: DraftRound[] = Array.from({ length: defaults.rounds }, () => ({
    id: newId("r-"),
    title: "",
    questions: Array.from({ length: defaults.questionsPerRound }, emptyQuestion),
  }));
  return { format: QUIZ_FORMAT, id, title, updatedAt, settings: { ...defaults.settings }, rounds, suddenDeath: [] };
}

/**
 * Checks a draft quiz from the builder and returns it rebuilt in field order,
 * or the problems that stop it being saved. `id` and `updatedAt` are not
 * checked here: the server sets them.
 */
export function checkDraft(v: unknown): { ok: true; quiz: QuizDraft } | { ok: false; problems: Problem[] } {
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  if (!isObj(v)) return { ok: false, problems: [{ path: "", message: "The quiz is not a JSON object." }] };

  if (v.format !== QUIZ_FORMAT) add("format", `The quiz must use format "${QUIZ_FORMAT}".`);
  const title = typeof v.title === "string" ? v.title.trim() : "";
  if (title === "") add("title", "The quiz needs a title.");
  else if (len(title) > L.titleChars) add("title", `The quiz title can be at most ${L.titleChars} characters.`);

  const settings = checkSettings(v.settings, add);
  const seen = new Set<string>();

  const rounds: DraftRound[] = [];
  if (!Array.isArray(v.rounds)) add("rounds", "The rounds must be a list.");
  else if (v.rounds.length > L.rounds) add("rounds", `A quiz can have at most ${L.rounds} rounds.`);
  else v.rounds.forEach((r, i) => {
    const path = `rounds.${i}`;
    const label = `Round ${i + 1}`;
    if (!isObj(r)) { add(path, `${label} is not a JSON object.`); return; }
    if (typeof r.id !== "string" || !ROUND_ID.test(r.id) || seen.has(r.id)) add(`${path}.id`, `${label} has a missing, malformed or repeated id.`);
    else seen.add(r.id);
    const rt = r.title === undefined ? "" : r.title;
    if (!str(rt, L.roundTitleChars)) add(`${path}.title`, `${label}'s title can be at most ${L.roundTitleChars} characters.`);
    const questions: DraftQuestion[] = [];
    if (!Array.isArray(r.questions)) add(`${path}.questions`, `${label}'s questions must be a list.`);
    else if (r.questions.length > L.questionsPerRound) add(`${path}.questions`, `${label} can have at most ${L.questionsPerRound} questions.`);
    else r.questions.forEach((q, j) => {
      const out = checkQuestion(q, `${path}.questions.${j}`, `${label}, question ${j + 1}`, seen, add);
      if (out) questions.push(out);
    });
    // Pushed even when a check failed: any problem refuses the whole draft below.
    rounds.push({ id: r.id as string, title: rt as string, questions });
  });

  const suddenDeath: DraftQuestion[] = [];
  const sd = v.suddenDeath === undefined ? [] : v.suddenDeath;
  if (!Array.isArray(sd)) add("suddenDeath", "The sudden-death questions must be a list.");
  else if (sd.length > L.suddenDeath) add("suddenDeath", `A quiz can have at most ${L.suddenDeath} sudden-death questions.`);
  else sd.forEach((q, i) => {
    const out = checkQuestion(q, `suddenDeath.${i}`, `Sudden-death question ${i + 1}`, seen, add);
    if (out) suddenDeath.push(out);
  });

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, quiz: { format: QUIZ_FORMAT, id: "", title, updatedAt: "", settings, rounds, suddenDeath } };
}

function checkSettings(v: unknown, add: (p: string, m: string) => void): QuizSettings {
  const s = validateSettings(v, add);
  // Field order of QuizSettings in formats.ts
  return {
    lockMode: s.lockMode, timerSeconds: s.timerSeconds, halftimeAfterRound: s.halftimeAfterRound, joker: s.joker,
    maxTeams: s.maxTeams, suddenDeathScope: s.suddenDeathScope, suddenDeathMax: s.suddenDeathMax, closestScoring: s.closestScoring,
  };
}

function checkQuestion(q: unknown, path: string, label: string, seen: Set<string>, add: (p: string, m: string) => void): DraftQuestion | null {
  if (!isObj(q)) { add(path, `${label} is not a JSON object.`); return null; }
  let ok = true;
  const bad = (p: string, m: string) => { ok = false; add(`${path}${p}`, m); };
  if (typeof q.id !== "string" || !QUESTION_ID.test(q.id) || seen.has(q.id)) bad(".id", `${label} has a missing, malformed or repeated id.`);
  else seen.add(q.id);
  const text = q.text === undefined ? "" : q.text;
  if (!str(text, L.textChars)) bad(".text", `${label}'s text can be at most ${L.textChars} characters.`);
  if (q.note !== undefined && !str(q.note, L.textChars)) bad(".note", `${label}'s host note can be at most ${L.textChars} characters.`);
  if (q.timerSeconds !== undefined && !(isInt(q.timerSeconds) && q.timerSeconds >= 10 && q.timerSeconds <= 300)) {
    bad(".timerSeconds", `${label}'s timer must be a whole number of seconds from 10 to 300.`);
  }
  let media: DraftMedia | undefined;
  if (q.media !== undefined) {
    const m = q.media;
    if (!isObj(m) || typeof m.kind !== "string" || len(m.kind) > 20) bad(".media", `${label}'s media is not valid.`);
    else if (typeof m.file !== "string" || !MEDIA_FILE.test(m.file)) bad(".media.file", `${label}'s media file name is missing or not allowed.`);
    else if (m.alt !== undefined && !str(m.alt, L.textChars)) bad(".media.alt", `${label}'s image description can be at most ${L.textChars} characters.`);
    else media = m.alt === undefined ? { kind: m.kind, file: m.file } : { kind: m.kind, file: m.file, alt: m.alt };
  }
  const answer = checkAnswer(q.answer, label, (p, m) => bad(`.answer${p}`, m));
  if (!ok || !answer) return null;
  // Field order of Question in formats.ts. Each field was checked above (ok is still true).
  return {
    id: q.id as string,
    text: text as string,
    ...(q.note !== undefined ? { note: q.note as string } : {}),
    ...(q.timerSeconds !== undefined ? { timerSeconds: q.timerSeconds as number } : {}),
    ...(media ? { media } : {}),
    answer,
  };
}

/** Answers may be incomplete in a draft (empty text, no value yet); types and sizes must hold. */
function checkAnswer(a: unknown, label: string, bad: (p: string, m: string) => void): DraftAnswer | FutureAnswer | null {
  if (!isObj(a) || typeof a.type !== "string") { bad("", `${label} has no answer type.`); return null; }
  switch (a.type) {
    case "text": {
      const acc = a.accepted;
      if (!Array.isArray(acc) || acc.length > L.accepted || !acc.every((x) => str(x, L.answerChars))) {
        bad(".accepted", `${label}'s accepted answers must be a list of at most ${L.accepted}, each at most ${L.answerChars} characters.`); return null;
      }
      return { type: "text", accepted: acc as string[] };
    }
    case "choice": {
      const opts = a.options;
      if (!Array.isArray(opts) || opts.length > L.options || !opts.every((x) => str(x, L.answerChars))) {
        bad(".options", `${label} can have at most ${L.options} options, each at most ${L.answerChars} characters.`); return null;
      }
      if (!isInt(a.correct) || a.correct < -1 || a.correct >= L.options) { bad(".correct", `${label}'s correct option is not valid.`); return null; }
      return { type: "choice", options: opts as string[], correct: a.correct };
    }
    case "number":
    case "closest": {
      const value = a.value;
      if (value !== null && !isNum(value)) { bad(".value", `${label}'s answer must be a number.`); return null; }
      if (a.type === "number") return { type: "number", value };
      const range = a.range;
      if (range !== undefined && !(isNum(range) && range >= 0)) { bad(".range", `${label}'s range must be a number of 0 or more.`); return null; }
      return range === undefined ? { type: "closest", value } : { type: "closest", value, range };
    }
    case "datetime": {
      if (a.precision !== "year" && a.precision !== "date" && a.precision !== "time") { bad(".precision", `${label} must say year, date or time.`); return null; }
      if (!str(a.value, 12)) { bad(".value", `${label}'s answer is too long.`); return null; }
      if (a.scoring !== "exact" && a.scoring !== "closest") { bad(".scoring", `${label} must be scored "exact" or "closest".`); return null; }
      const range = a.range;
      if (range !== undefined && !(isNum(range) && range >= 0)) { bad(".range", `${label}'s range must be a number of 0 or more.`); return null; }
      const out: DraftAnswer = { type: "datetime", precision: a.precision, value: a.value, scoring: a.scoring };
      if (range !== undefined) out.range = range;
      return out;
    }
    default:
      // A type from a newer Lock-In: keep it as it is, so saving never loses it (S-09). It stays "not ready".
      if (len(a.type) > 20) { bad(".type", `${label}'s answer type is not valid.`); return null; }
      return a as FutureAnswer;
  }
}
