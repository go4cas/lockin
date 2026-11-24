// Quiz library and builder, server side (B3): the quiz store, quiz media and
// the /api/quizzes routes (TECH-SPEC 5.2, 9.1, 9.2; H-01 to H-04, S-09).

import { join } from "node:path";
import type { App } from "../app.ts";
import { UPLOAD_CSP, errorResponse, json, BodyTooLarge, readFormBody, readJsonBody } from "../http.ts";
import { contentType, serveFile, type FileSource } from "../static.ts";
import { MAX_IMAGE_BYTES, QuizError, QuizStore } from "./store.ts";

export { QuizStore, QuizError } from "./store.ts";

/** Largest quiz JSON body accepted by PUT (a full 20 x 30 quiz is well under this). */
const MAX_QUIZ_BODY = 2_000_000;

let current: QuizStore | null = null;

/**
 * B1's hook (TECH-SPEC 5.2, B1): appends an answer accepted while marking to
 * the quiz file. Also available as app.services.quizStore.
 */
export function saveAcceptedAnswer(quizId: string, questionId: string, text: string): void {
  current?.saveAcceptedAnswer(quizId, questionId, text);
}

function fail(e: unknown): Response {
  if (e instanceof QuizError) {
    const body: Record<string, unknown> = { error: { code: e.code, message: e.message } };
    if (e.problems) (body.error as Record<string, unknown>).problems = e.problems;
    return Response.json(body, { status: e.status });
  }
  throw e;
}

/** Reads files from the data folder, for serveFile (ETag, 304). */
const dataFiles: FileSource = {
  async read(path) {
    const f = Bun.file(path);
    return (await f.exists()) ? new Uint8Array(await f.arrayBuffer()) : null;
  },
  exists: () => true,
};

export function register(app: App): void {
  const inUse = app.db.query<{ one: number }, [string]>("SELECT 1 AS one FROM nights WHERE quiz_id = ? AND status = 'open' LIMIT 1");
  const store = new QuizStore({
    dir: join(app.config.dataDir, "quizzes"),
    now: () => app.clock.now(),
    inUse: (id) => inUse.get(id) !== null,
    log: app.log,
  });
  current = store;
  app.services.quizStore = { saveAcceptedAnswer: (q, id, text) => store.saveAcceptedAnswer(q, id, text) };
  const host = { host: true };

  app.route("GET", "/api/quizzes", () => json({ quizzes: store.list() }), host);

  app.route("POST", "/api/quizzes", async (req) => {
    const body = await readJsonBody(req);
    if (!body) return errorResponse(400, "bad_request", "The request was not understood.");
    try {
      return json({ quiz: store.create(body.title) });
    } catch (e) { return fail(e); }
  }, host);

  app.route("GET", "/api/quizzes/:id", (_req, ctx) => {
    try {
      return json(store.get(ctx.params.id!));
    } catch (e) { return fail(e); }
  }, host);

  app.route("PUT", "/api/quizzes/:id", async (req, ctx) => {
    const body = await readJsonBody(req, MAX_QUIZ_BODY);
    if (!body) return errorResponse(400, "bad_request", "The quiz was too big or not understood.");
    try {
      return json(store.save(ctx.params.id!, body.quiz, body.baseUpdatedAt));
    } catch (e) { return fail(e); }
  }, host);

  app.route("POST", "/api/quizzes/:id/duplicate", async (req, ctx) => {
    const body = (await readJsonBody(req)) ?? {};
    try {
      return json({ quiz: store.duplicate(ctx.params.id!, body.title) });
    } catch (e) { return fail(e); }
  }, host);

  app.route("DELETE", "/api/quizzes/:id", (_req, ctx) => {
    try {
      store.remove(ctx.params.id!);
      return json({ ok: true });
    } catch (e) { return fail(e); }
  }, host);

  app.route("POST", "/api/quizzes/:id/media", async (req, ctx) => {
    const length = Number(req.headers.get("content-length") ?? "0");
    if (length > MAX_IMAGE_BYTES + 64 * 1024) return errorResponse(413, "too_large", "That picture is over 5 MB. Try a smaller one.");
    // Counted while it is read, so a chunked body is stopped at the limit too (SA-02).
    let form: FormData | null;
    try {
      form = await readFormBody(req, MAX_IMAGE_BYTES + 64 * 1024);
    } catch (e) {
      if (!(e instanceof BodyTooLarge)) throw e;
      return errorResponse(413, "too_large", "That picture is over 5 MB. Try a smaller one.");
    }
    if (!form) return errorResponse(400, "bad_request", "The upload was not understood.");
    const file = form.get("file");
    if (!(file instanceof Blob)) return errorResponse(400, "no_file", "Pick a picture to upload.");
    if (file.size > MAX_IMAGE_BYTES) return errorResponse(413, "too_large", "That picture is over 5 MB. Try a smaller one.");
    try {
      const name = store.saveMedia(ctx.params.id!, form.get("questionId"), new Uint8Array(await file.arrayBuffer()));
      return json({ file: name });
    } catch (e) { return fail(e); }
  }, host);

  // Quiz media for the builder; host only (TECH-SPEC 9.1). Served like an upload (12.4).
  app.route("GET", "/media/quiz/:quizId/:file", async (req, ctx) => {
    const path = store.mediaPath(ctx.params.quizId!, ctx.params.file!);
    const res = path && (await serveFile(req, dataFiles, path, { "Content-Security-Policy": UPLOAD_CSP, "Content-Type": contentType(path) }));
    return res || errorResponse(404, "not_found", "There is no such picture.");
  }, host);
}
