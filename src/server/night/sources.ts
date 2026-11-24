// What the engine reads from the data folder: quizzes (5.2), the venue file
// (5.4) and the theme's name and version (5.3). These are read straight from
// the files, read-only, so the engine works before B3 and B4 merge; writing
// those files stays with B3 and B4.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateQuiz, validateTheme, validateVenue, defaultVenue, type QuizFile, type Problem, type VenueFile } from "../../shared/formats.ts";

export type QuizLoad = { ok: true; quiz: QuizFile } | { ok: false; code: "not_found" | "quiz_not_ready"; problems: Problem[] };

/** The venue name when the theme names none (one place for the fallback, code review LI-023). */
export const DEFAULT_VENUE_NAME = "Lock-In";

export interface VenueInfo {
  name: string;
  themeVersion: string;
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

export function fileSources(dataDir: string): Sources {
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
    venueInfo() {
      let venue = defaultVenue();
      const venuePath = join(dataDir, "venue.json");
      if (existsSync(venuePath)) {
        try {
          const v = validateVenue(JSON.parse(readFileSync(venuePath, "utf8")));
          if (v.ok) venue = v.value;
        } catch { /* unreadable: defaults */ }
      }
      let name = DEFAULT_VENUE_NAME;
      let themeVersion = "default";
      const themePath = join(dataDir, "theme", "theme.json");
      if (existsSync(themePath)) {
        try {
          const text = readFileSync(themePath, "utf8");
          themeVersion = createHash("sha256").update(text).digest("hex").slice(0, 12);
          const t = validateTheme(JSON.parse(text));
          if (t.ok && t.value.name) name = t.value.name;
        } catch { /* unreadable: defaults */ }
      }
      return { name, themeVersion, venue };
    },
    mediaPath(quizId, file) {
      if (!QUIZ_ID.test(quizId) || !SAFE_FILE.test(file)) return null;
      const p = join(quizDir(quizId), "media", file);
      return existsSync(p) ? p : null;
    },
  };
}
