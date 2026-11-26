// What the engine reads: quizzes (5.2) and their pictures straight from the data
// folder, read-only, and the venue (5.3, 5.4) through B4's branding store, the one
// reader of the theme and venue files (code review LI-020).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_COUNTDOWN, validateQuiz, type CountdownStyle, type QuizFile, type Problem, type VenueFile } from "../../shared/formats.ts";
import type { BrandingStore } from "../branding/store.ts";

export type QuizLoad = { ok: true; quiz: QuizFile } | { ok: false; code: "not_found" | "quiz_not_ready"; problems: Problem[] };

/** The venue name when the theme names none (one place for the fallback, code review LI-023). */
export const DEFAULT_VENUE_NAME = "Lock-In";

export interface VenueInfo {
  name: string;
  themeVersion: string;
  countdown: CountdownStyle;
  venue: VenueFile;
}

export interface Sources {
  loadQuiz(quizId: string): QuizLoad;
  venueInfo(): VenueInfo;
  /** Absolute path of a question image in a quiz's media folder, or null. */
  mediaPath(quizId: string, file: string): string | null;
}

const QUIZ_ID = /^[a-z0-9-]{1,60}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The venue as the engine sees it, from the branding store (the store's name is null when unset). */
export function venueFrom(branding: Pick<BrandingStore, "venueName" | "themeVersion" | "venue" | "theme">): () => VenueInfo {
  return () => ({
    name: branding.venueName() ?? DEFAULT_VENUE_NAME, themeVersion: branding.themeVersion(),
    countdown: branding.theme().countdown ?? DEFAULT_COUNTDOWN, venue: branding.venue(),
  });
}

/** Quizzes and pictures from the data folder; the venue from `venueInfo`. */
export function fileSources(dataDir: string, venueInfo: () => VenueInfo): Sources {
  const quizDir = (id: string) => join(dataDir, "quizzes", id);
  return {
    loadQuiz(quizId) {
      if (!QUIZ_ID.test(quizId)) return { ok: false, code: "not_found", problems: [] };
      const path = join(quizDir(quizId), "quiz.json");
      if (!existsSync(path)) return { ok: false, code: "not_found", problems: [] };
      let json: unknown;
      try {
        json = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        return { ok: false, code: "quiz_not_ready", problems: [{ path: "", message: "The quiz file is not valid JSON." }] };
      }
      const v = validateQuiz(json, {
        folderId: quizId,
        mediaExists: (file) => SAFE_FILE.test(file) && existsSync(join(quizDir(quizId), "media", file)),
      });
      return v.ok ? { ok: true, quiz: v.quiz } : { ok: false, code: "quiz_not_ready", problems: v.problems };
    },
    venueInfo,
    mediaPath(quizId, file) {
      if (!QUIZ_ID.test(quizId) || !SAFE_FILE.test(file)) return null;
      const p = join(quizDir(quizId), "media", file);
      return existsSync(p) ? p : null;
    },
  };
}
