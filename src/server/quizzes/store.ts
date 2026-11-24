// Quiz store (B3): quizzes/<id>/quiz.json plus media/ (TECH-SPEC 5.1, 5.2, S-09).
//
// The folder is the source of truth and is rescanned on every list, so a quiz
// folder copied in by hand appears straight away. Files are written atomically
// through writeJsonAtomic (B0).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { QUIZ_LIMITS, validateQuiz, type Problem, type QuizFile } from "../../shared/formats.ts";
import { writeJsonAtomic } from "../files.ts";
import { MEDIA_FILE, QUESTION_ID, QUIZ_ID, checkDraft, newQuiz } from "./draft.ts";

export interface QuizSummary {
  id: string;
  title: string;
  rounds: number;
  questions: number;
  updatedAt: string;
  ready: boolean;
  problems: Problem[];
}

export interface LoadedQuiz {
  quiz: QuizFile;
  ready: boolean;
  problems: Problem[];
}

/** Why a store call failed; the routes turn it into a status code (TECH-SPEC 9.2). */
export class QuizError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly problems?: Problem[]) {
    super(message);
  }
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const TRASH = ".trash";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Question pictures the builder made (saveMedia): question id, content hash, optional number. */
const BUILDER_MEDIA = /^q-[a-z0-9]{8}-[0-9a-f]{4,16}(?:-\d+)?\.(?:jpg|png|webp)$/;
/** An unreferenced picture is removed on a draft save once it is this old (SA-20). */
const MEDIA_SWEEP_AFTER_MS = 60 * 60_000;

export interface QuizStoreOptions {
  /** `<dataDir>/quizzes` */
  dir: string;
  now: () => number;
  /** True while an open night uses the quiz (H-02: no edits while it runs). */
  inUse: (quizId: string) => boolean;
  log?: (message: string) => void;
}

/** Makes a folder id from a title (TECH-SPEC 5.2): "Friday Classics!" -> "friday-classics". */
export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/g, "");
  return s === "" ? "quiz" : s;
}

/** Image type from the file's first bytes: JPEG, PNG or WebP (H-03), else null. */
export function sniffImage(b: Uint8Array): "jpg" | "png" | "webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "png";
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

export class QuizStore {
  constructor(private readonly opts: QuizStoreOptions) {
    mkdirSync(opts.dir, { recursive: true });
  }

  private folder(id: string): string {
    return join(this.opts.dir, id);
  }

  private exists(id: string): boolean {
    return QUIZ_ID.test(id) && existsSync(join(this.folder(id), "quiz.json"));
  }

  private mediaExists(id: string) {
    return (file: string) => MEDIA_FILE.test(file) && existsSync(join(this.folder(id), "media", file));
  }

  /** Reads quiz.json; throws QuizError 404 if the quiz is not there. */
  private readRaw(id: string): { raw: unknown; updatedAt: string; parseError?: string } {
    if (!this.exists(id)) throw new QuizError(404, "not_found", "There is no quiz with that name. It may have been deleted.");
    const path = join(this.folder(id), "quiz.json");
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return { raw: undefined, updatedAt: statSync(path).mtime.toISOString(), parseError: "The quiz file is not valid JSON." };
    }
    const u = isObj(raw) ? raw.updatedAt : undefined;
    const updatedAt = typeof u === "string" && !Number.isNaN(Date.parse(u)) ? u : statSync(path).mtime.toISOString();
    return { raw, updatedAt };
  }

  private readiness(id: string, raw: unknown): { ready: boolean; problems: Problem[] } {
    const v = validateQuiz(raw, { folderId: id, mediaExists: this.mediaExists(id) });
    return v.ok ? { ready: true, problems: [] } : { ready: false, problems: v.problems };
  }

  /** Every quiz in the folder, newest edit first. Unreadable files are listed as not ready. */
  list(): QuizSummary[] {
    const out: QuizSummary[] = [];
    for (const entry of readdirSync(this.opts.dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !this.exists(entry.name)) continue;
      const id = entry.name;
      try {
        const { raw, updatedAt, parseError } = this.readRaw(id);
        const r = isObj(raw) ? raw : {};
        const rounds = Array.isArray(r.rounds) ? r.rounds : [];
        const questions = rounds.reduce((n: number, x) => n + (isObj(x) && Array.isArray(x.questions) ? x.questions.length : 0), 0);
        const title = typeof r.title === "string" && r.title.trim() !== "" ? r.title : id;
        const { ready, problems } = parseError ? { ready: false, problems: [{ path: "", message: parseError }] } : this.readiness(id, raw);
        out.push({ id, title, rounds: rounds.length, questions, updatedAt, ready, problems });
      } catch (e) {
        this.opts.log?.(`Quiz "${id}" could not be read: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)));
  }

  /** One quiz for the builder. A file the builder cannot edit answers 422 with its problems. */
  get(id: string): LoadedQuiz {
    const { raw, updatedAt, parseError } = this.readRaw(id);
    if (parseError) throw new QuizError(422, "quiz_unreadable", `${parseError} Fix or remove quizzes/${id}/quiz.json.`);
    const draft = checkDraft(raw);
    if (!draft.ok) {
      throw new QuizError(422, "quiz_unreadable", `The builder can't open this quiz file: ${draft.problems[0]!.message}`, draft.problems);
    }
    const quiz = { ...draft.quiz, id, updatedAt } as unknown as QuizFile;
    return { quiz, ...this.readiness(id, raw) };
  }

  /** A free folder id for a title: "friday-classics", then "friday-classics-2", ... */
  private freeId(title: string): string {
    const base = slugify(title);
    if (!existsSync(this.folder(base))) return base;
    for (let n = 2; ; n++) {
      const id = `${base}-${n}`;
      if (!existsSync(this.folder(id))) return id;
    }
  }

  private stamp(previous?: string): string {
    let t = this.opts.now();
    if (previous !== undefined) {
      const p = Date.parse(previous);
      if (!Number.isNaN(p) && t <= p) t = p + 1;   // updatedAt always moves forward, so 409 checks work
    }
    return new Date(t).toISOString();
  }

  private write(quiz: Obj): void {
    writeJsonAtomic(join(this.folder(quiz.id as string), "quiz.json"), quiz);
  }

  private checkTitle(title: unknown): string {
    const t = typeof title === "string" ? title.trim() : "";
    if (t === "") throw new QuizError(400, "bad_title", "Give the quiz a title.");
    if ([...t].length > 80) throw new QuizError(400, "bad_title", "The title can be at most 80 characters.");
    return t;
  }

  create(title: unknown): QuizFile {
    const t = this.checkTitle(title);
    const quiz = newQuiz(this.freeId(t), t, this.stamp());
    mkdirSync(join(this.folder(quiz.id), "media"), { recursive: true });
    this.write(quiz as unknown as Obj);
    return quiz;
  }

  /** Saves a draft from the builder (PUT). 409 if someone saved since `baseUpdatedAt`, 423 while in use. */
  save(id: string, draftJson: unknown, baseUpdatedAt: unknown): LoadedQuiz {
    const current = this.readRaw(id);
    if (this.opts.inUse(id)) throw new QuizError(423, "quiz_in_use", "A night is using this quiz, so it can't be changed until the night ends.");
    if (typeof baseUpdatedAt !== "string" || baseUpdatedAt !== current.updatedAt) {
      throw new QuizError(409, "edited_elsewhere", "This quiz was changed somewhere else since you opened it. Reload to see the latest version.");
    }
    const draft = checkDraft(draftJson);
    if (!draft.ok) throw new QuizError(400, "invalid_quiz", draft.problems[0]!.message, draft.problems);
    const quiz = { ...draft.quiz, id, updatedAt: this.stamp(current.updatedAt) };
    this.write(quiz);
    this.sweepMedia(id, quiz);
    return { quiz: quiz as unknown as QuizFile, ...this.readiness(id, quiz) };
  }

  duplicate(id: string, title: unknown): QuizFile {
    const { quiz } = this.get(id);
    const t = title === undefined ? `${quiz.title.slice(0, 73)} (copy)` : this.checkTitle(title);
    const newId = this.freeId(t);
    const media = join(this.folder(id), "media");
    mkdirSync(join(this.folder(newId), "media"), { recursive: true });
    if (existsSync(media)) cpSync(media, join(this.folder(newId), "media"), { recursive: true });
    // Round and question ids stay as they are: media files are named after them, and a night keeps its own snapshot.
    const copy = { ...(quiz as unknown as Obj), id: newId, title: t, updatedAt: this.stamp() };
    this.write(copy);
    return copy as unknown as QuizFile;
  }

  /** Moves the folder to quizzes/.trash/ (TECH-SPEC 9.2); 423 while in use. */
  remove(id: string): void {
    this.readRaw(id);
    if (this.opts.inUse(id)) throw new QuizError(423, "quiz_in_use", "A night is using this quiz, so it can't be deleted until the night ends.");
    const trash = join(this.opts.dir, TRASH);
    mkdirSync(trash, { recursive: true });
    const when = new Date(this.opts.now()).toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
    let target = join(trash, `${id}-${when}`);
    for (let n = 2; existsSync(target); n++) target = join(trash, `${id}-${when}-${n}`);
    renameSync(this.folder(id), target);
  }

  /** Stores an uploaded image for a question (H-03); returns its file name in media/. */
  saveMedia(id: string, questionId: unknown, bytes: Uint8Array): string {
    this.readRaw(id);
    if (this.opts.inUse(id)) throw new QuizError(423, "quiz_in_use", "A night is using this quiz, so it can't be changed until the night ends.");
    if (typeof questionId !== "string" || !QUESTION_ID.test(questionId)) throw new QuizError(400, "bad_question", "The picture is not linked to a question.");
    if (bytes.length > MAX_IMAGE_BYTES) throw new QuizError(413, "too_large", "That picture is over 5 MB. Try a smaller one.");
    const ext = sniffImage(bytes);
    if (!ext) throw new QuizError(415, "not_an_image", "That file is not a JPEG, PNG or WebP picture.");
    // 16 hex characters of the content's SHA-256 (code review LI-004, audit SA-20). A file already at
    // that name is reused only if its bytes are the same; otherwise a numbered name is used, so an
    // upload never reports success while keeping another picture.
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const dir = join(this.folder(id), "media");
    mkdirSync(dir, { recursive: true });
    for (let n = 1; ; n++) {
      const file = `${questionId}-${hash}${n === 1 ? "" : `-${n}`}.${ext}`;
      const path = join(dir, file);
      if (!existsSync(path)) {
        writeFileSync(path, bytes);
        return file;
      }
      if (Buffer.from(bytes).equals(readFileSync(path))) {
        utimesSync(path, new Date(), new Date());   // fresh again: not swept before the draft refers to it
        return file;
      }
    }
  }

  /**
   * Removes question pictures no question refers to (audit SA-20), after a draft save. Only
   * builder-made names (`q-xxxxxxxx-<hex>.<ext>`) are touched, and only when older than
   * MEDIA_SWEEP_AFTER_MS, so an upload whose draft save is still on its way is kept.
   */
  private sweepMedia(id: string, quiz: Obj): void {
    const dir = join(this.folder(id), "media");
    if (!existsSync(dir)) return;
    const used = new Set<string>();
    const rounds = Array.isArray(quiz.rounds) ? quiz.rounds : [];
    const questions = [
      ...rounds.flatMap((r) => (r && Array.isArray((r as Obj).questions) ? (r as Obj).questions as unknown[] : [])),
      ...(Array.isArray(quiz.suddenDeath) ? quiz.suddenDeath : []),
    ];
    for (const q of questions) {
      const m = (q as Obj | null)?.media as Obj | undefined;
      if (m && typeof m.file === "string") used.add(m.file);
    }
    const cutoff = Date.now() - MEDIA_SWEEP_AFTER_MS;
    for (const file of readdirSync(dir)) {
      if (used.has(file) || !BUILDER_MEDIA.test(file)) continue;
      const path = join(dir, file);
      try {
        if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
      } catch { /* gone already */ }
    }
  }

  /** Path of a media file for GET /media/quiz/:quizId/:file, or null. */
  mediaPath(id: string, file: string): string | null {
    if (!this.exists(id) || !MEDIA_FILE.test(file)) return null;
    const path = join(this.folder(id), "media", file);
    return existsSync(path) ? path : null;
  }

  /**
   * B1 calls this when the host accepts a typed answer while marking (TECH-SPEC 5.2, H-10).
   * It works while the night runs (the in-use lock is for the builder) and never throws:
   * the night's own snapshot already has the answer, so a missing quiz is only logged.
   */
  saveAcceptedAnswer(quizId: string, questionId: string, text: string): void {
    const answer = text.trim();
    try {
      if (answer === "" || [...answer].length > QUIZ_LIMITS.answerChars) return;
      const { raw, updatedAt } = this.readRaw(quizId);
      if (!isObj(raw)) return;
      const questions = [
        ...(Array.isArray(raw.rounds) ? raw.rounds.flatMap((r) => (isObj(r) && Array.isArray(r.questions) ? r.questions : [])) : []),
        ...(Array.isArray(raw.suddenDeath) ? raw.suddenDeath : []),
      ];
      const q = questions.find((x) => isObj(x) && x.id === questionId);
      if (!isObj(q) || !isObj(q.answer) || q.answer.type !== "text" || !Array.isArray(q.answer.accepted)) {
        this.opts.log?.(`Accepted answer not saved: quiz "${quizId}" has no typed-answer question ${questionId}.`);
        return;
      }
      const key = answer.toLowerCase();
      if (q.answer.accepted.some((a) => typeof a === "string" && a.trim().toLowerCase() === key)) return;
      if (q.answer.accepted.length >= QUIZ_LIMITS.accepted) return;   // the file stays openable in the builder (LI-009)
      q.answer.accepted.push(answer);
      raw.updatedAt = this.stamp(updatedAt);
      this.write(raw);
    } catch (e) {
      this.opts.log?.(`Accepted answer not saved to quiz "${quizId}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
