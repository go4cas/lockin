// B3: quiz store and /api/quizzes routes (TECH-SPEC 5.2, 9.1, 9.2; H-01, H-02, H-03, S-09).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveAcceptedAnswer } from "../../src/server/quizzes/index.ts";
import { checkDraft } from "../../src/server/quizzes/draft.ts";
import { slugify, sniffImage } from "../../src/server/quizzes/store.ts";
import type { QuizFile } from "../../src/shared/formats.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";

let s: TestServer;
let cookie: string;
beforeAll(async () => {
  s = await startTestServer();
  cookie = await s.signIn();
});
afterAll(async () => { await s.stop(); });

const api = (path: string, init: RequestInit = {}) => s.fetch(path, { ...init, cookie });
const send = (method: string, path: string, body?: unknown) =>
  api(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const quizDir = (id: string) => join(s.dataDir, "quizzes", id);
const readQuiz = (id: string) => JSON.parse(readFileSync(join(quizDir(id), "quiz.json"), "utf8"));

async function create(title: string): Promise<QuizFile> {
  const res = await send("POST", "/api/quizzes", { title });
  expect(res.status).toBe(200);
  return (await res.json()).quiz;
}

/** Fills every question so the quiz is ready. */
function complete(q: QuizFile): QuizFile {
  const copy = structuredClone(q);
  copy.rounds.forEach((r, i) => {
    r.title = `Round ${i + 1}`;
    r.questions.forEach((x, j) => { x.text = `Question ${i + 1}.${j + 1}?`; x.answer = { type: "text", accepted: [`Answer ${j}`] }; });
  });
  return copy;
}

async function save(q: QuizFile, base = q.updatedAt) {
  return send("PUT", `/api/quizzes/${q.id}`, { quiz: q, baseUpdatedAt: base });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

describe("host only", () => {
  test("every quiz route answers 401 without a session", async () => {
    for (const [m, p] of [["GET", "/api/quizzes"], ["POST", "/api/quizzes"], ["GET", "/api/quizzes/x"], ["PUT", "/api/quizzes/x"],
      ["POST", "/api/quizzes/x/duplicate"], ["DELETE", "/api/quizzes/x"], ["POST", "/api/quizzes/x/media"], ["GET", "/media/quiz/x/a.png"]] as const) {
      const res = await s.fetch(p, { method: m, body: m === "GET" ? undefined : "{}" });
      expect(res.status).toBe(401);
    }
  });

  test("mutating requests from another origin are refused", async () => {
    const res = await s.fetch("/api/quizzes", { method: "POST", body: JSON.stringify({ title: "x" }), cookie, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/quizzes", () => {
  test("creates the default shape: 6 rounds of 5 empty questions, default settings (H-02)", async () => {
    const q = await create("Friday Classics");
    expect(q.id).toBe("friday-classics");
    expect(q.format).toBe("lockin.quiz/1");
    expect(q.rounds).toHaveLength(6);
    for (const r of q.rounds) {
      expect(r.id).toMatch(/^r-[a-z0-9]{8}$/);
      expect(r.questions).toHaveLength(5);
      for (const x of r.questions) expect(x.id).toMatch(/^q-[a-z0-9]{8}$/);
    }
    expect(q.settings).toEqual({ lockMode: "question", timerSeconds: 60, halftimeAfterRound: "auto", joker: false, maxTeams: 30, suddenDeathScope: "first", suddenDeathMax: 3, closestScoring: "closest" });
    expect(q.suddenDeath).toEqual([]);
    expect(readQuiz("friday-classics")).toEqual(q);
  });

  test("a taken id gets -2, -3; titles become safe folder names", async () => {
    expect((await create("Friday Classics")).id).toBe("friday-classics-2");
    expect((await create("Friday classics!")).id).toBe("friday-classics-3");
    expect(slugify("Quiz Night: Rock & Roll")).toBe("quiz-night-rock-and-roll");
    expect(slugify("Café Ölé")).toBe("cafe-ole");
    expect(slugify("???")).toBe("quiz");
    expect(slugify("x".repeat(100))).toHaveLength(56);
  });

  test("needs a title of 1 to 80 characters", async () => {
    expect((await send("POST", "/api/quizzes", { title: "  " })).status).toBe(400);
    const res = await send("POST", "/api/quizzes", { title: "x".repeat(81) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("80");
  });

  test("files are written atomically, with two-space indentation and the format's field order", async () => {
    const q = await create("Order check");
    const text = readFileSync(join(quizDir(q.id), "quiz.json"), "utf8");
    expect(text.startsWith('{\n  "format": "lockin.quiz/1",\n  "id": "order-check",\n  "title": "Order check",\n  "updatedAt"')).toBe(true);
    expect(text.endsWith("\n")).toBe(true);
    expect(existsSync(join(quizDir(q.id), "quiz.json.tmp"))).toBe(false);
  });
});

describe("GET /api/quizzes (H-01)", () => {
  test("lists title, round and question counts, updatedAt, readiness and problems", async () => {
    const q = await create("Listed quiz");
    const res = await api("/api/quizzes");
    expect(res.status).toBe(200);
    const row = (await res.json()).quizzes.find((x: { id: string }) => x.id === q.id);
    expect(row).toMatchObject({ id: q.id, title: "Listed quiz", rounds: 6, questions: 30, updatedAt: q.updatedAt, ready: false });
    expect(row.problems[0].message).toBe("Round 1, question 1 has no question text.");
  });

  test("a quiz folder copied in by hand appears (S-09)", async () => {
    const q = complete(await create("Original"));
    await save(q);
    cpSync(quizDir(q.id), quizDir("copied-in"), { recursive: true });
    const file = readQuiz("copied-in");
    file.id = "copied-in";
    file.title = "Copied in";
    writeFileSync(join(quizDir("copied-in"), "quiz.json"), JSON.stringify(file));
    const rows = (await (await api("/api/quizzes")).json()).quizzes;
    expect(rows.find((x: { id: string }) => x.id === "copied-in")).toMatchObject({ title: "Copied in", ready: true, problems: [] });
  });

  test("invalid files show as not ready with their problems, and never break the list", async () => {
    mkdirSync(quizDir("broken-json"), { recursive: true });
    writeFileSync(join(quizDir("broken-json"), "quiz.json"), "{ nope");
    mkdirSync(quizDir("future-quiz"), { recursive: true });
    writeFileSync(join(quizDir("future-quiz"), "quiz.json"), JSON.stringify({ format: "lockin.quiz/2", id: "future-quiz", title: "From the future", updatedAt: "2026-01-01T00:00:00.000Z", rounds: [] }));
    mkdirSync(quizDir("Not A Valid Id"), { recursive: true });
    writeFileSync(join(quizDir("Not A Valid Id"), "quiz.json"), "{}");
    const res = await api("/api/quizzes");
    expect(res.status).toBe(200);
    const rows = (await res.json()).quizzes as { id: string; title: string; ready: boolean; problems: { message: string }[] }[];
    const broken = rows.find((x) => x.id === "broken-json")!;
    expect(broken).toMatchObject({ title: "broken-json", ready: false });
    expect(broken.problems[0]!.message).toBe("The quiz file is not valid JSON.");
    const future = rows.find((x) => x.id === "future-quiz")!;
    expect(future.ready).toBe(false);
    expect(future.problems.map((p) => p.message)).toContain('This quiz uses format "lockin.quiz/2", which this version of Lock-In cannot read.');
    expect(rows.find((x) => x.id === "Not A Valid Id")).toBeUndefined();
    // The builder can't open them, and says why.
    const open = await api("/api/quizzes/broken-json");
    expect(open.status).toBe(422);
    expect((await open.json()).error.code).toBe("quiz_unreadable");
  });

  test("the newest edit comes first", async () => {
    const a = await create("Older");
    await Bun.sleep(5);
    const b = await create("Newer");
    const ids = ((await (await api("/api/quizzes")).json()).quizzes as { id: string }[]).map((x) => x.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });
});

describe("GET and PUT /api/quizzes/:id (H-02)", () => {
  test("GET returns the quiz with readiness; 404 for an unknown or unsafe id", async () => {
    const q = await create("Get me");
    const body = await (await api(`/api/quizzes/${q.id}`)).json();
    expect(body.quiz).toEqual(q);
    expect(body.ready).toBe(false);
    expect(body.problems.length).toBeGreaterThan(0);
    expect((await api("/api/quizzes/nope")).status).toBe(404);
    expect((await api("/api/quizzes/..%2F..%2Fetc")).status).toBe(404);
  });

  test("an incomplete draft saves (autosave) and reports its problems in plain English", async () => {
    const q = await create("Draft");
    q.rounds[0]!.questions[0]!.text = "Who directed Jaws?";
    const res = await save(q);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.quiz.rounds[0].questions[0].text).toBe("Who directed Jaws?");
    expect(body.problems.map((p: { message: string }) => p.message)).toContain("Round 1, question 1 has no answer.");
    expect(readQuiz(q.id).rounds[0].questions[0].text).toBe("Who directed Jaws?");
  });

  test("a complete quiz is ready; updatedAt is set by the server and always moves forward", async () => {
    const q = complete(await create("Complete"));
    const body = await (await save(q)).json();
    expect(body).toMatchObject({ ready: true, problems: [] });
    expect(body.quiz.updatedAt > q.updatedAt).toBe(true);
    const again = await (await save({ ...body.quiz, updatedAt: "1999-01-01T00:00:00.000Z" }, body.quiz.updatedAt)).json();
    expect(again.quiz.updatedAt > body.quiz.updatedAt).toBe(true);
  });

  test("every answer type and setting round-trips (H-03)", async () => {
    const q = complete(await create("All types"));
    const [a, b, c, d, e] = q.rounds[0]!.questions as [QuizFile["rounds"][0]["questions"][0], ...QuizFile["rounds"][0]["questions"]];
    a.answer = { type: "text", accepted: ["Steven Spielberg", "Spielberg"] };
    a.note = "Pronounced SPEEL-burg";
    a.timerSeconds = 90;
    b!.answer = { type: "choice", options: ["Paris", "Rome", "Berlin"], correct: 1 };
    c!.answer = { type: "number", value: 7 };
    d!.answer = { type: "closest", value: 8849, range: 100 };
    e!.answer = { type: "datetime", precision: "date", value: "1969-07-20", scoring: "closest", range: 30 };
    q.rounds[1]!.questions[0]!.answer = { type: "datetime", precision: "year", value: "1066", scoring: "exact" };
    q.rounds[1]!.questions[1]!.answer = { type: "datetime", precision: "time", value: "20:17", scoring: "exact" };
    q.settings = { lockMode: "round", timerSeconds: 45, halftimeAfterRound: 4, joker: true, maxTeams: 12, suddenDeathScope: "all", suddenDeathMax: 5, closestScoring: "range" };
    q.suddenDeath = [{ id: "q-sd000001", text: "How tall is Big Ben in metres?", answer: { type: "closest", value: 96 } }];
    const body = await (await save(q)).json();
    expect(body.ready).toBe(true);
    const { updatedAt: _u, ...rest } = body.quiz;
    const { updatedAt: _v, ...want } = q;
    expect(rest).toEqual(want);
  });

  test("409 edited_elsewhere when baseUpdatedAt is stale", async () => {
    const q = await create("Two tabs");
    const first = await (await save(q)).json();
    const res = await save(q, q.updatedAt);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("edited_elsewhere");
    expect((await save(first.quiz)).status).toBe(200);
    expect((await send("PUT", `/api/quizzes/${q.id}`, { quiz: q })).status).toBe(409);
  });

  test("400 with plain-English problems for a draft that breaks the format's limits", async () => {
    const q = await create("Limits");
    const cases: [(x: QuizFile) => void, string][] = [
      [(x) => { x.title = ""; }, "The quiz needs a title."],
      [(x) => { x.rounds[0]!.questions[0]!.text = "x".repeat(301); }, "Round 1, question 1's text can be at most 300 characters."],
      [(x) => { x.rounds[0]!.questions[1]!.id = x.rounds[0]!.questions[0]!.id; }, "Round 1, question 2 has a missing, malformed or repeated id."],
      [(x) => { x.settings.timerSeconds = 5; }, "The timer must be a whole number of seconds from 10 to 300."],
      [(x) => { x.rounds = Array.from({ length: 21 }, () => x.rounds[0]!); }, "A quiz can have at most 20 rounds."],
      [(x) => { (x.rounds[0]!.questions[0]!.answer as { options: string[] }) = { type: "choice", options: Array(7).fill("a"), correct: 0 } as never; }, "Round 1, question 1 can have at most 6 options, each at most 100 characters."],
      [(x) => { x.rounds[0]!.questions[0]!.media = { kind: "image", file: "../../auth.json" }; }, "Round 1, question 1's media file name is missing or not allowed."],
    ];
    for (const [change, message] of cases) {
      const bad = structuredClone(q);
      change(bad);
      const res = await save(bad);
      expect(res.status).toBe(400);
      const err = (await res.json()).error;
      expect(err.code).toBe("invalid_quiz");
      expect(err.message).toBe(message);
    }
    expect(readQuiz(q.id)).toEqual(q);
  });

  test("unknown answer and media types from a newer Lock-In are kept, and make the quiz not ready", () => {
    const draft = checkDraft({ format: "lockin.quiz/1", title: "T", rounds: [{ id: "r-aaaaaaaa", questions: [
      { id: "q-aaaaaaaa", text: "Hum it", media: { kind: "audio", file: "q-aaaaaaaa.mp3" }, answer: { type: "hum", tune: "x" } }] }] });
    expect(draft.ok).toBe(true);
    if (draft.ok) {
      const q = (draft.quiz.rounds as { questions: Record<string, unknown>[] }[])[0]!.questions[0]!;
      expect(q.answer).toEqual({ type: "hum", tune: "x" });
      expect(q.media).toEqual({ kind: "audio", file: "q-aaaaaaaa.mp3" });
    }
  });

  test("renaming changes the title, not the folder", async () => {
    const q = await create("Old name");
    const body = await (await save({ ...q, title: "New name" })).json();
    expect(body.quiz).toMatchObject({ id: "old-name", title: "New name" });
    expect(existsSync(quizDir("old-name"))).toBe(true);
    expect(existsSync(quizDir("new-name"))).toBe(false);
  });

  test("a body over the limit is refused", async () => {
    const q = await create("Huge");
    const res = await send("PUT", `/api/quizzes/${q.id}`, { quiz: q, baseUpdatedAt: q.updatedAt, pad: "x".repeat(2_100_000) });
    expect(res.status).toBe(400);
  });
});

describe("423 while a night uses the quiz (H-02)", () => {
  function openNight(quizId: string) {
    s.app.db.run(
      "INSERT INTO nights (id, quiz_id, quiz_title, quiz_snapshot, room_code, status, opened_at, state) VALUES (?, ?, 'T', '{}', 'BCDF', 'open', 0, '{}')",
      ["n-test-" + quizId, quizId],
    );
    return () => s.app.db.run("UPDATE nights SET status = 'ended' WHERE id = ?", ["n-test-" + quizId]);
  }

  test("PUT, DELETE and media uploads answer 423 quiz_in_use; reading and duplicating still work", async () => {
    const q = await create("In use");
    const end = openNight(q.id);
    try {
      const put = await save(q);
      expect(put.status).toBe(423);
      expect((await put.json()).error.code).toBe("quiz_in_use");
      expect((await send("DELETE", `/api/quizzes/${q.id}`)).status).toBe(423);
      const form = new FormData();
      form.set("questionId", q.rounds[0]!.questions[0]!.id);
      form.set("file", new Blob([PNG]), "a.png");
      expect((await api(`/api/quizzes/${q.id}/media`, { method: "POST", body: form })).status).toBe(423);
      expect((await api(`/api/quizzes/${q.id}`)).status).toBe(200);
      expect((await send("POST", `/api/quizzes/${q.id}/duplicate`, { title: "In use, copy" })).status).toBe(200);
    } finally {
      end();
    }
    expect((await save(q)).status).toBe(200);
  });
});

describe("POST /api/quizzes/:id/duplicate and DELETE", () => {
  test("duplicate copies the quiz and its media under a new id and title", async () => {
    const q = complete(await create("Dup source"));
    const form = new FormData();
    const qid = q.rounds[0]!.questions[0]!.id;
    form.set("questionId", qid);
    form.set("file", new Blob([PNG]), "a.png");
    const file = (await (await api(`/api/quizzes/${q.id}/media`, { method: "POST", body: form })).json()).file;
    q.rounds[0]!.questions[0]!.media = { kind: "image", file };
    await save(q);
    const res = await send("POST", `/api/quizzes/${q.id}/duplicate`, { title: "Dup copy" });
    expect(res.status).toBe(200);
    const copy = (await res.json()).quiz;
    expect(copy).toMatchObject({ id: "dup-copy", title: "Dup copy" });
    expect(copy.rounds).toEqual(readQuiz(q.id).rounds);
    expect(existsSync(join(quizDir("dup-copy"), "media", file))).toBe(true);
    const listed = (await (await api("/api/quizzes")).json()).quizzes.find((x: { id: string }) => x.id === "dup-copy");
    expect(listed.ready).toBe(true);
    // Without a title it is "<title> (copy)"
    expect((await (await send("POST", `/api/quizzes/${q.id}/duplicate`, {})).json()).quiz.title).toBe("Dup source (copy)");
    expect((await send("POST", "/api/quizzes/nope/duplicate", {})).status).toBe(404);
  });

  test("delete moves the folder to quizzes/.trash/ and it leaves the list", async () => {
    const q = await create("Bin me");
    const res = await send("DELETE", `/api/quizzes/${q.id}`);
    expect(await res.json()).toEqual({ ok: true });
    expect(existsSync(quizDir(q.id))).toBe(false);
    const trashed = readdirSync(join(s.dataDir, "quizzes", ".trash"));
    expect(trashed.some((n) => n.startsWith("bin-me-"))).toBe(true);
    const ids = (await (await api("/api/quizzes")).json()).quizzes.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(q.id);
    expect((await send("DELETE", `/api/quizzes/${q.id}`)).status).toBe(404);
    // Deleting a quiz with the same name again does not clash in the trash.
    const again = await create("Bin me");
    expect((await send("DELETE", `/api/quizzes/${again.id}`)).status).toBe(200);
  });
});

describe("POST /api/quizzes/:id/media and GET /media/quiz/* (H-03)", () => {
  async function upload(id: string, bytes: Uint8Array<ArrayBuffer>, questionId = "q-abcdefgh") {
    const form = new FormData();
    form.set("questionId", questionId);
    form.set("file", new Blob([bytes]), "upload.bin");
    return api(`/api/quizzes/${id}/media`, { method: "POST", body: form });
  }

  test("stores JPEG, PNG and WebP by first bytes, named after the question and a content hash", async () => {
    const q = await create("Pictures");
    const png = await (await upload(q.id, PNG)).json();
    expect(png.file).toMatch(/^q-abcdefgh-[0-9a-f]{16}\.png$/);
    const jpg = await (await upload(q.id, JPG)).json();
    expect(jpg.file).toMatch(/^q-abcdefgh-[0-9a-f]{16}\.jpg$/);
    const webp = new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 ")]);
    expect((await (await upload(q.id, webp)).json()).file).toMatch(/\.webp$/);
    expect(sniffImage(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });

  test("refuses other files, oversize files and bad question ids", async () => {
    const q = await create("Bad pictures");
    const svg = await upload(q.id, new TextEncoder().encode("<svg onload=alert(1)>"));
    expect(svg.status).toBe(415);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await upload(q.id, big)).status).toBe(413);
    expect((await upload(q.id, PNG, "../x")).status).toBe(400);
    expect((await upload("nope", PNG)).status).toBe(404);
  });

  test("a stored image is served to the host with nosniff and the upload CSP; media makes readiness depend on the file", async () => {
    const q = complete(await create("Served"));
    const qid = q.rounds[0]!.questions[0]!.id;
    const file = (await (await upload(q.id, PNG, qid)).json()).file;
    const res = await api(`/media/quiz/${q.id}/${file}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect((await api(`/media/quiz/${q.id}/missing.png`)).status).toBe(404);
    expect((await api(`/media/quiz/${q.id}/..%2Fquiz.json`)).status).toBe(404);

    q.rounds[0]!.questions[0]!.media = { kind: "image", file: "q-gone0000-ffff.png" };
    const body = await (await save(q)).json();
    expect(body.ready).toBe(false);
    expect(body.problems[0].message).toContain("is missing from the quiz's media folder");
  });
});

describe("saveAcceptedAnswer (for B1, H-10)", () => {
  test("appends to accepted, skips repeats, and works while a night uses the quiz", async () => {
    const q = complete(await create("Accepting"));
    await save(q);
    const qid = q.rounds[2]!.questions[3]!.id;
    s.app.db.run("INSERT INTO nights (id, quiz_id, quiz_title, quiz_snapshot, room_code, status, opened_at, state) VALUES ('n-acc', ?, 'T', '{}', 'BCDG', 'open', 0, '{}')", [q.id]);
    try {
      await s.app.services.quizStore!.saveAcceptedAnswer(q.id, qid, "  Spielberg ");
      await s.app.services.quizStore!.saveAcceptedAnswer(q.id, qid, "spielberg");
      saveAcceptedAnswer(q.id, qid, "Steven Spielberg");
    } finally {
      s.app.db.run("UPDATE nights SET status = 'ended' WHERE id = 'n-acc'");
    }
    const file = readQuiz(q.id);
    expect(file.rounds[2].questions[3].answer.accepted).toEqual(["Answer 3", "Spielberg", "Steven Spielberg"]);
    expect(file.updatedAt > q.updatedAt).toBe(true);
  });

  test("a missing quiz or question, or a non-text question, is only logged", async () => {
    const q = complete(await create("Accepting 2"));
    q.rounds[0]!.questions[0]!.answer = { type: "number", value: 3 };
    const saved = (await (await save(q)).json()).quiz;
    s.app.services.quizStore!.saveAcceptedAnswer("gone", "q-aaaaaaaa", "x");
    s.app.services.quizStore!.saveAcceptedAnswer(q.id, q.rounds[0]!.questions[0]!.id, "3");
    s.app.services.quizStore!.saveAcceptedAnswer(q.id, "q-zzzzzzzz", "x");
    expect(readQuiz(q.id)).toEqual(saved);
    expect(s.logs.some((l) => l.includes("Accepted answer not saved"))).toBe(true);
  });
});
