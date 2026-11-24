// The engine through the real server and WebSocket protocol (TECH-SPEC 10, 11, 13.1):
// both lock modes end to end, binding and byes, coalesced sends, media and history routes.
import { afterEach, describe, expect, test } from "bun:test";
import type { DisplayView, HostView, ServerMsg, TeamView } from "../../src/shared/protocol.ts";
import { engines } from "../../src/server/night/index.ts";
import { connectClient, type TestClient } from "../helpers/client.ts";
import { FakeClock } from "../helpers/fake-clock.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";
import { choice, fakeCopy, fakeRules, makeQuiz, number, q, text, writeQuiz } from "./fakes.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const open: TestClient[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  while (open.length) open.pop()!.close();
  while (servers.length) await servers.pop()!.stop();
});

async function server(opts: { dataDir?: string; clock?: FakeClock } = {}) {
  const clock = opts.clock ?? new FakeClock();
  const s = await startTestServer({ clock, dataDir: opts.dataDir, keepData: !!opts.dataDir });
  servers.push(s);
  s.app.services.rules = fakeRules;
  s.app.services.copyPicker = fakeCopy();
  const { scheduler } = engines.get(s.app)!;
  /** Moves fake time on and runs due timers (the lock, last-seconds line). */
  const advance = (ms: number) => { clock.advance(ms); scheduler.runDue(); };
  return { s, clock, advance };
}

async function client(s: TestServer, role: "host" | "display" | "team", cookie?: string, token?: string) {
  const c = await connectClient(s, { role, cookie });
  open.push(c);
  await c.hello(token ? { token } : {});
  return c;
}

/** The newest state a client has received. */
function view<T>(c: TestClient): T {
  const states = c.received.filter((m): m is Extract<ServerMsg, { t: "state" }> => m.t === "state");
  return states[states.length - 1]!.view as T;
}
const errCode = (ack: Extract<ServerMsg, { t: "ack" }>) => (ack.ok ? "ok" : ack.error.code);
const settle = () => Bun.sleep(150);

async function ok(c: TestClient, name: string, args: object = {}) {
  const ack = await c.cmd(name, args);
  if (!ack.ok) throw new Error(`${name}: ${JSON.stringify(ack.error)}`);
  return ack.result as Record<string, unknown>;
}

function quizFor(lockMode: "question" | "round") {
  const img = q(text("Abbey Road"), { media: { kind: "image", file: "cover.png" } });
  const qs = [q(text("Fleetwood Mac")), q(choice(0)), img, q(number(4))];
  return { quiz: makeQuiz(`night-${lockMode}`, [qs], { lockMode, timerSeconds: 30, joker: true }), qs, img };
}

for (const lockMode of ["question", "round"] as const) {
  describe(`a night in ${lockMode} mode through the protocol`, () => {
    test("join, show, answer, change, pause, resume, +15 s, lock early, timer runs out, mark, reveal, end", async () => {
      const { s, advance } = await server();
      const { quiz, qs, img } = quizFor(lockMode);
      writeQuiz(s.dataDir, quiz, { "cover.png": PNG });
      const cookie = await s.signIn();
      const hostC = await client(s, "host", cookie);
      const display = await client(s, "display", cookie);   // opened from the console's browser: paired

      const opened = await ok(hostC, "night.open", { quizId: quiz.id });
      const roomCode = opened.roomCode as string;
      expect(view<HostView>(hostC).phase).toBe("lobby");
      await settle();
      expect(view<DisplayView>(display).night!.roomCode).toBe(roomCode);

      const phoneA = await client(s, "team");
      const joined = await ok(phoneA, "team.join", { roomCode, name: "Quizteama Aguilera" });
      expect(view<TeamView>(phoneA).self!.name).toBe("Quizteama Aguilera");
      const phoneB = await client(s, "team");
      await ok(phoneB, "team.join", { roomCode, name: "Les Quizerables" });
      await settle();
      expect(view<DisplayView>(display).teams.map((t) => t.name)).toEqual(["Quizteama Aguilera", "Les Quizerables"]);
      expect(view<HostView>(hostC).teams.every((t) => t.connected)).toBe(true);

      // a reconnect with the token binds the same team (11.1)
      const phoneA2 = await client(s, "team", undefined, joined.token as string);
      expect(phoneA2.received.find((m) => m.t === "welcome")).toMatchObject({ teamId: joined.teamId });
      phoneA2.close();

      expect((await phoneA.cmd("joker.play", { round: 0 })).ok).toBe(true);
      await ok(hostC, "quiz.start");
      await ok(hostC, "round.start");

      // before it is shown, the image is for the host only (9.1)
      expect((await s.fetch(`/media/q/${img.id}`)).status).toBe(404);
      expect((await s.fetch(`/media/q/${img.id}`, { cookie })).status).toBe(200);

      const answer = async (phone: TestClient, qid: string, value: object) => (await phone.cmd("answer.submit", { questionId: qid, value }));

      await ok(hostC, "question.next");
      const a1 = await answer(phoneA, qs[0]!.id, { type: "text", text: "Fleetwod Mac" });
      expect(a1.ok && (a1.result as { receivedAt: number }).receivedAt).toBeGreaterThan(0);
      expect(view<TeamView>(phoneA).answers).toEqual([{ questionId: qs[0]!.id, value: { type: "text", text: "Fleetwod Mac" }, receivedAt: expect.any(Number), counted: true }]);
      expect((await answer(phoneA, qs[0]!.id, { type: "text", text: "Fleetwood Mac" })).ok).toBe(true);   // change
      await settle();
      expect(view<DisplayView>(display).question!.answered).toBe(1);
      expect(view<HostView>(hostC).teams.find((t) => t.id === joined.teamId)!.answeredCurrent).toBe(true);

      if (lockMode === "question") {
        await ok(hostC, "timer.start");
        advance(5_000);
        await ok(hostC, "timer.pause");
        expect(view<HostView>(hostC).current!.timer).toMatchObject({ state: "paused", remainingMs: 25_000 });
        await ok(hostC, "timer.add", { seconds: 15 });
        await ok(hostC, "timer.resume");
        advance(40_000);   // runs out
        await settle();
        expect(view<DisplayView>(display).question!.status).toBe("locked");
        expect(view<DisplayView>(display).lockedMoment).toMatchObject({ all: false });
        expect(errCode(await answer(phoneB, qs[0]!.id, { type: "text", text: "x" }))).toBe("too_late");
        for (const qq of qs.slice(1)) {
          await ok(hostC, "question.next");
          if (qq === img) expect((await s.fetch(`/media/q/${img.id}`)).status).toBe(200);
          await answer(phoneA, qq.id, qq === qs[1] ? { type: "choice", index: 0 } : qq === qs[3] ? { type: "number", value: 4 } : { type: "text", text: "abbey road" });
          await ok(hostC, "lock");   // early
        }
      } else {
        await ok(hostC, "question.next");
        await ok(hostC, "question.next");
        await ok(hostC, "question.next");
        expect((await s.fetch(`/media/q/${img.id}`)).status).toBe(200);
        expect(view<TeamView>(phoneA).questions.length).toBe(4);
        await answer(phoneA, qs[1]!.id, { type: "choice", index: 0 });
        await answer(phoneA, qs[2]!.id, { type: "text", text: "abbey road" });
        await answer(phoneA, qs[3]!.id, { type: "number", value: 4 });
        await ok(hostC, "timer.start");
        advance(10_000);
        await ok(hostC, "timer.pause");
        await ok(hostC, "timer.add", { seconds: 15 });
        await ok(hostC, "timer.resume");
        await answer(phoneB, qs[0]!.id, { type: "text", text: "the mac" });
        await ok(hostC, "lock");   // early: locks every open question
        expect(errCode(await answer(phoneB, qs[1]!.id, { type: "choice", index: 1 }))).toBe("too_late");
      }
      await ok(hostC, "round.finish");
      const marking = view<HostView>(hostC).marking!;
      if (lockMode === "round") {
        expect(marking.pendingTotal).toBe(1);
        await ok(hostC, "mark.group", { questionId: qs[0]!.id, key: "mac", mark: "wrong" });
      }
      await ok(hostC, "reveal.start");
      await settle();
      expect(view<DisplayView>(display).reveal!.answerText).toBe("Fleetwood Mac");
      for (let i = 0; i < 4; i++) await ok(hostC, "reveal.next");
      await settle();
      const st = view<DisplayView>(display).standings!;
      expect(st.rows[0]).toMatchObject({ name: "Quizteama Aguilera", total: 8, jokerThisRound: true, position: 1 });
      await ok(hostC, "quiz.end");
      await settle();
      expect(view<DisplayView>(display).final!.winners.map((w) => w.name)).toEqual(["Quizteama Aguilera"]);

      // history (9.2): the list, and the detail for this night
      const list = await (await s.fetch("/api/history", { cookie })).json() as { nights: { id: string; winners: string[]; teams: number }[] };
      expect(list.nights[0]).toMatchObject({ teams: 2, winners: ["Quizteama Aguilera"] });
      const detail = await (await s.fetch(`/api/history/${list.nights[0]!.id}`, { cookie })).json() as Record<string, any>;
      expect(detail.night).toMatchObject({ status: "ended", quizTitle: quiz.title });
      expect(detail.standings.map((x: { name: string; position: number }) => [x.name, x.position])).toEqual([["Quizteama Aguilera", 1], ["Les Quizerables", 2]]);
      expect(detail.rounds[0].questions.map((x: { answerText: string }) => x.answerText)).toEqual(["Fleetwood Mac", "A. Paris", "Abbey Road", "4"]);
      expect(detail.answers).toContainEqual({ teamId: joined.teamId, questionId: qs[1]!.id, display: "A. Paris", mark: "correct" });
      expect((await s.fetch("/api/history")).status).toBe(401);
      expect((await s.fetch("/api/history/n-nope", { cookie })).status).toBe(404);

      await ok(hostC, "night.close");
      expect(await phoneA.next("bye")).toEqual({ t: "bye", reason: "night_closed" });
      await settle();
      expect(view<DisplayView>(display).phase).toBe("idle");
      expect((await s.fetch(`/media/q/${img.id}`, { cookie })).status).toBe(404);
    });
  });
}

describe("connections", () => {
  test("rejoin on a new phone: old phone gets bye moved; removed team gets bye removed", async () => {
    const { s } = await server();
    const { quiz } = quizFor("question");
    writeQuiz(s.dataDir, quiz, { "cover.png": PNG });
    const cookie = await s.signIn();
    const hostC = await client(s, "host", cookie);
    const { roomCode } = await ok(hostC, "night.open", { quizId: quiz.id });
    const old = await client(s, "team");
    const j = await ok(old, "team.join", { roomCode, name: "Sherlock Ohms" });
    const codeShown = view<TeamView>(old).self!.rejoinCode;
    const fresh = await client(s, "team");
    const r = await ok(fresh, "team.rejoin", { code: codeShown });
    expect(r.teamId).toBe(j.teamId);
    expect(await old.next("bye")).toEqual({ t: "bye", reason: "moved" });
    expect(view<TeamView>(fresh).self!.rejoinCode).not.toBe(codeShown);
    await ok(hostC, "team.remove", { teamId: j.teamId });
    expect(await fresh.next("bye")).toEqual({ t: "bye", reason: "removed" });
    await settle();
    expect(view<HostView>(hostC).teams).toEqual([]);
  });

  test("answer submissions are coalesced for other screens; the submitter's view is immediate", async () => {
    const { s } = await server();
    const qq = q(text("x"));
    writeQuiz(s.dataDir, makeQuiz("co", [[qq]]));
    const cookie = await s.signIn();
    const hostC = await client(s, "host", cookie);
    const { roomCode } = await ok(hostC, "night.open", { quizId: "co" });
    const phones: TestClient[] = [];
    for (let i = 0; i < 5; i++) {
      const p = await client(s, "team");
      await ok(p, "team.join", { roomCode, name: `Team ${i}` });
      phones.push(p);
    }
    await ok(hostC, "quiz.start");
    await ok(hostC, "round.start");
    await ok(hostC, "question.next");
    await settle();
    const before = hostC.received.filter((m) => m.t === "state").length;
    await Promise.all(phones.map((p, i) => p.cmd("answer.submit", { questionId: qq.id, value: { type: "text", text: `a${i}` } })));
    for (const p of phones) expect(view<TeamView>(p).answers.length).toBe(1);
    await settle();
    const after = hostC.received.filter((m) => m.t === "state").length;
    expect(after - before).toBeLessThanOrEqual(2);
    expect(view<HostView>(hostC).current!.answered).toBe(5);
  });

  test("a server restart mid-question keeps every answer and the running timer (7.6)", async () => {
    const clock = new FakeClock();
    const first = await server({ clock, dataDir: (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "lockin-restart-")) });
    const dataDir = first.s.dataDir;
    const qq = q(number(7));
    writeQuiz(dataDir, makeQuiz("rs", [[qq, q(number(1))]]));
    const cookie = await first.s.signIn();
    const hostC = await client(first.s, "host", cookie);
    const { roomCode } = await ok(hostC, "night.open", { quizId: "rs" });
    const phone = await client(first.s, "team");
    const { token } = await ok(phone, "team.join", { roomCode, name: "Restart Rovers" });
    await ok(hostC, "quiz.start");
    await ok(hostC, "round.start");
    await ok(hostC, "question.next");
    await ok(hostC, "timer.start");
    await ok(phone, "answer.submit", { questionId: qq.id, value: { type: "number", value: 7 } });
    await first.s.stop();
    servers.splice(servers.indexOf(first.s), 1);
    open.length = 0;

    clock.advance(120_000);   // the timer ran out while the server was down
    const second = await server({ clock, dataDir });
    const phone2 = await client(second.s, "team", undefined, token as string);
    const v = view<TeamView>(phone2);
    expect(v.self!.name).toBe("Restart Rovers");
    expect(v.questions[0]!.status).toBe("locked");
    expect(v.answers[0]!.value).toEqual({ type: "number", value: 7 });
    const cookie2 = await second.s.signIn();
    const host2 = await client(second.s, "host", cookie2);
    expect(view<HostView>(host2).standings!.rows[0]!.total).toBe(1);
  });
});

describe("history detail with sudden death", () => {
  test("asked sudden-death questions come last as round -1, with their answers (Cas, 2026-11-24)", async () => {
    const { s } = await server();
    const q1 = q(number(1));
    const sd1 = q(choice(2));
    const sdUnused = q(choice(1));
    writeQuiz(s.dataDir, makeQuiz("sdh", [[q1]], {}, [sd1, sdUnused]));
    const cookie = await s.signIn();
    const hostC = await client(s, "host", cookie);
    const { roomCode } = await ok(hostC, "night.open", { quizId: "sdh" });
    const a = await client(s, "team");
    const { teamId } = await ok(a, "team.join", { roomCode, name: "Alpha" });
    const b = await client(s, "team");
    await ok(b, "team.join", { roomCode, name: "Bravo" });
    for (const cmd of ["quiz.start", "round.start", "question.next", "lock", "round.finish", "leaderboard.show", "sd.start", "sd.ask"]) await ok(hostC, cmd);
    await ok(a, "answer.submit", { questionId: sd1.id, value: { type: "choice", index: 2 } });
    for (const cmd of ["lock", "sd.reveal", "quiz.end"]) await ok(hostC, cmd);
    const list = await (await s.fetch("/api/history", { cookie })).json() as { nights: { id: string; winners: string[] }[] };
    expect(list.nights[0]!.winners).toEqual(["Alpha"]);
    const detail = await (await s.fetch(`/api/history/${list.nights[0]!.id}`, { cookie })).json() as Record<string, any>;
    expect(detail.rounds.map((r: { index: number; title: string }) => [r.index, r.title])).toEqual([[0, "Round 1"], [-1, "Deadlock"]]);
    expect(detail.rounds[1].questions).toEqual([{ id: sd1.id, number: 1, text: sd1.text, answerText: "C. Oslo" }]);
    expect(detail.answers).toContainEqual({ teamId, questionId: sd1.id, display: "C. Oslo", mark: "correct" });
    expect(detail.standings.map((r: { name: string; position: number }) => [r.name, r.position])).toEqual([["Alpha", 1], ["Bravo", 2]]);
  });
});

describe("theme changes (B4)", () => {
  test("saving the theme sends every screen a fresh view with the new venue name and themeVersion", async () => {
    const { s } = await server();
    const cookie = await s.signIn();
    const display = await client(s, "display", cookie);
    const before = view<DisplayView>(display).venue;
    const res = await s.fetch("/api/theme", { method: "PUT", cookie, body: JSON.stringify({ theme: { format: "lockin.theme/1", name: "The Example Arms" } }) });
    expect(res.status).toBe(200);
    const st = await display.next("state");
    expect(st.view.venue.name).toBe("The Example Arms");
    expect(st.view.venue.themeVersion).not.toBe(before.themeVersion);
  });
});
