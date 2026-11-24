// Question image addresses (TECH-SPEC 9.1, code review LI-003).
// The address names the night and the image file, so a browser cache can never show
// one night's picture for another night's question with the same id. Quiz media file
// names are content-derived (quizzes/store.ts saveMedia), and a night's quiz cannot be
// edited while it runs, so night + file identifies the bytes.

import { createHash } from "node:crypto";

/** The version for a question image in a night. */
export function imageVersion(nightId: string, file: string): string {
  return createHash("sha256").update(`${nightId}\0${file}`).digest("hex").slice(0, 16);
}

/** The public address of a question's image in a night. */
export function imageUrl(nightId: string, questionId: string, file: string): string {
  return `/media/q/${questionId}?v=${imageVersion(nightId, file)}`;
}
