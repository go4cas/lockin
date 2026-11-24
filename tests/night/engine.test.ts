// Night engine on fake time (TECH-SPEC 7, 8, 11, 13.1).
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DisplayView, HostView, TeamView, View } from "../../src/shared/protocol.ts";
import { hostView, teamView, displayView } from "../../src/server/night/views.ts";
import { MOVE_CODE_TTL_MS } from "../../src/server/night/engine.ts";
import { loadFixtures } from "../fixtures/views/index.ts";
import { choice, code, host, joinTeam, makeQuiz, number, q, rig, text, writeQuiz, type Rig } from "./fakes.ts";

const rigs: Rig[] = [];
afterEach(() => { while (rigs.length) rigs.pop()!.close(); });

function setup(settings: Parameters<typeof makeQuiz>[2] = {}, opts: { rounds?: number; sd?: number } = {}) {
  const r = rig();
  rigs.push(r);
  const rounds = Array.from({ length: opts.rounds ?? 2 }, () => [q(text("Fleetwood Mac")), q(choice(0)), q(number(4))]);
  const sd = Array.from({ length: opts.sd ?? 3 }, () => q(choice(1)));
  const quiz = makeQuiz("friday", rounds, settings, sd);
  writeQuiz(r.dataDir, quiz);
  return { r, quiz, rounds, sd };
}

const submit = (r: Rig, team: ReturnType<typeof joinTeam>, questionId: string, value: object) =>
  r.engine.command(team, "answer.submit", { questionId, value });

/** Opens the night, joins teams, starts the quiz and round 0. */
function start(r: Rig, names: string[]) {
  host(r, "night.open", { quizId: "friday" });
  const teams = names.map((n) => joinTeam(r, n));
  host(r, "quiz.start");
  host(r, "round.start");
  return teams;
}

describe("night.open (7.2)", () => {
  test("opens a ready quiz into the lobby with a room code and snapshot", () => {
    const { r, quiz } = setup();
    expect(code(r.engine.command(r.host, "night.open", { quizId: "nope" }))).toBe("not_found");
    const res = host(r, "night.open", { quizId: "friday", plannedStart: r.clock.now() + 3_600_000 }) as { roomCode: string; nightId: string };
    expect(res.roomCode).toMatch(/^[BCDFGHJKMNPQRSTVWXZ]{4}$/);
    expect(res.nightId).toMatch(/^n-\d{8}-\d{4}-[a-z0-9]{4}$/);
    expect(r.engine.state.phase).toBe("lobby");
    expect(r.engine.m!.night.quiz).toEqual(quiz);
    expect(code(r.engine.command(r.host, "night.open", { quizId: "friday" }))).toBe("night_open");
    const v = displayView(r.engine);
    expect(v.night!.joinUrl).toBe(`https://quiz.example.com/j/${res.roomCode}`);
    expect(v.night!.holdingFrom).toBe(r.clock.now() + 3_600_000 - 30 * 60_000);
    expect(v.lines.lobby).toBe("lobby#0");
  });

  test("a quiz that is not ready is refused with its first problem", () => {
    const { r } = setup();
    writeFileSync(join(r.dataDir, "quizzes", "friday", "quiz.json"), JSON.stringify({ format: "lockin.quiz/1", id: "friday" }));
    const res = r.engine.command(r.host, "night.open", { quizId: "friday" });
    expect(code(res)).toBe("quiz_not_ready");
    expect(!res.ok && res.error.message).toContain("no title");
  });

  test("prizes default to venue.json and can be changed with night.update", () => {
    const { r } = setup();
    writeFileSync(join(r.dataDir, "venue.json"), JSON.stringify({ format: "lockin.venue/1", prizes: [{ place: 1, text: "A round of drinks" }] }));
    host(r, "night.open", { quizId: "friday" });
    expect(r.engine.m!.night.prizes).toEqual([{ place: 1, text: "A round of drinks" }]);
    host(r, "night.update", { prizes: [{ place: 1, text: "Chips" }], plannedStart: null });
    expect(displayView(r.engine).night!.prizes).toEqual([{ place: 1, text: "Chips" }]);
    expect(code(r.engine.command(r.host, "night.update", { prizes: [{ place: 0, text: "x" }] }))).toBe("bad_args");
  });
});

describe("teams (11, P-02, H-06)", () => {
  test("join checks the room code, one phone per team and the team limit, then closes at Quiz Start", () => {
    const { r } = setup({ maxTeams: 2 });
    host(r, "night.open", { quizId: "friday" });
    const a = { role: "team" as const, teamId: null, connId: 1 };
    expect(code(r.engine.command(a, "team.join", { roomCode: "ZZZZ", name: "A" }))).toBe("room_code");
    expect(code(r.engine.command(a, "team.join", { roomCode: r.engine.m!.night.roomCode, name: "x".repeat(31) }))).toBe("bad_args");
    const t1 = joinTeam(r, "Les Quizerables");
    expect(r.engine.state.flash).toMatchObject({ key: "team_joined", teamId: t1.teamId, line: "team_joined#0 Les Quizerables" });
    expect(code(r.engine.command({ ...a, connId: 2 }, "team.join", { roomCode: r.engine.m!.night.roomCode.toLowerCase(), name: "  les QUIZERABLES " }))).toBe("team_has_phone");
    joinTeam(r, "Agatha Quiztie");
    expect(code(r.engine.command({ ...a, connId: 3 }, "team.join", { roomCode: r.engine.m!.night.roomCode, name: "Third" }))).toBe("night_full");
    expect(r.engine.teamForToken(t1.token)).toBe(t1.teamId);
    expect(r.engine.teamForToken("nope")).toBeNull();
    const colours = r.engine.teams().map((t) => t.colour);
    expect(new Set(colours).size).toBe(2);
    host(r, "quiz.start");
    expect(code(r.engine.command({ ...a, connId: 4 }, "team.join", { roomCode: r.engine.m!.night.roomCode, name: "Late" }))).toBe("joining_closed");
  });

  test("quiz.start needs a team", () => {
    const { r } = setup();
    host(r, "night.open", { quizId: "friday" });
    expect(code(r.engine.command(r.host, "quiz.start", {}))).toBe("no_teams");
  });

  test("rejoin code moves the team: new token, old phone gets bye moved, a new code; 5 wrong tries a minute", () => {
    const { r } = setup();
    host(r, "night.open", { quizId: "friday" });
    const t = joinTeam(r, "Sherlock Ohms");
    const oldCode = r.engine.m!.teams.get(t.teamId)!.rejoinCode;
    expect(oldCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    const phone2 = { role: "team" as const, teamId: null, connId: 77 };
    r.events.length = 0;
    const res = r.engine.command(phone2, "team.rejoin", { code: oldCode.toLowerCase() });
    expect(res.ok).toBe(true);
    const { teamId, token } = (res as { result: { teamId: string; token: string } }).result;
    expect(teamId).toBe(t.teamId);
    expect(r.engine.teamForToken(token)).toBe(t.teamId);
    expect(r.engine.teamForToken(t.token)).toBeNull();
    expect(r.events.at(-1)!.byes).toEqual([{ teamId: t.teamId, reason: "moved", keepConn: 77 }]);
    expect(r.engine.m!.teams.get(t.teamId)!.rejoinCode).not.toBe(oldCode);
    const phone3 = { role: "team" as const, teamId: null, connId: 78 };
    expect(code(r.engine.command(phone3, "team.rejoin", { code: oldCode }))).toBe("bad_code");
    for (let i = 0; i < 4; i++) expect(code(r.engine.command(phone3, "team.rejoin", { code: "AAAAAA" }))).toBe("bad_code");
    const fresh = r.engine.m!.teams.get(t.teamId)!.rejoinCode;
    expect(code(r.engine.command(phone3, "team.rejoin", { code: fresh }))).toBe("too_many_tries");
    r.advance(60_001);
    expect(code(r.engine.command(phone3, "team.rejoin", { code: fresh }))).toBe("ok");
  });

  test("REVIEW finding 5: wrong rejoin tries count per IP across connections (10 a minute)", () => {
    const { r } = setup();
    host(r, "night.open", { quizId: "friday" });
    const t = joinTeam(r, "Sherlock Ohms");
    const fromIp = (connId: number, ip: string) => ({ role: "team" as const, teamId: null, connId, ip });
    for (let i = 0; i < 10; i++) expect(code(r.engine.command(fromIp(200 + i, "203.0.113.7"), "team.rejoin", { code: "AAAAAA" }))).toBe("bad_code");
    const real = r.engine.m!.teams.get(t.teamId)!.rejoinCode;
    expect(code(r.engine.command(fromIp(300, "203.0.113.7"), "team.rejoin", { code: real }))).toBe("too_many_tries");
    expect(code(r.engine.command(fromIp(301, "198.51.100.9"), "team.rejoin", { code: "AAAAAA" }))).toBe("bad_code");
    r.advance(60_001);
    expect(code(r.engine.command(fromIp(302, "203.0.113.7"), "team.rejoin", { code: real }))).toBe("ok");
  });

  test("move code works once and expires after 10 minutes", () => {
    const { r } = setup();
    host(r, "night.open", { quizId: "friday" });
    const t = joinTeam(r, "Quiz Khalifa");
    const mv = host(r, "team.moveCode", { teamId: t.teamId }) as { code: string; url: string };
    expect(mv.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(mv.url).toBe(`https://quiz.example.com/m/${mv.code}`);
    const phone = { role: "team" as const, teamId: null, connId: 90 };
    expect(code(r.engine.command(phone, "team.rejoin", { code: mv.code }))).toBe("ok");
    expect(code(r.engine.command({ ...phone, connId: 91 }, "team.rejoin", { code: mv.code }))).toBe("bad_code");
    const mv2 = host(r, "team.moveCode", { teamId: t.teamId }) as { code: string };
    r.advance(MOVE_CODE_TTL_MS);
    expect(code(r.engine.command({ ...phone, connId: 92 }, "team.rejoin", { code: mv2.code }))).toBe("bad_code");
  });

  test("rename and remove (lobby only); a removed team's phone gets bye removed and its name is free", () => {
    const { r } = setup();
    host(r, "night.open", { quizId: "friday" });
    const a = joinTeam(r, "Pub Fiction");
    const b = joinTeam(r, "The Smartinis");
    expect(code(r.engine.command(r.host, "team.rename", { teamId: b.teamId, name: "pub fiction" }))).toBe("name_taken");
    host(r, "team.rename", { teamId: b.teamId, name: "Smartinis" });
    host(r, "team.remove", { teamId: a.teamId });
    expect(r.events.at(-1)!.byes).toEqual([{ teamId: a.teamId, reason: "removed" }]);
    expect(r.engine.teamForToken(a.token)).toBeNull();
    expect(r.engine.teams().map((t) => t.name)).toEqual(["Smartinis"]);
    joinTeam(r, "Pub Fiction");
    host(r, "quiz.start");
    expect(code(r.engine.command(r.host, "team.remove", { teamId: b.teamId }))).toBe("wrong_phase");
    host(r, "team.rename", { teamId: b.teamId, name: "The Smartinis" });
  });
});

describe("per-question lock mode (7.2, 7.3)", () => {
  test("show, answer, change answer, pause, resume, add 15 s, timer runs out, then lock early", () => {
    const { r, rounds } = setup();
    const [a, b] = start(r, ["A", "B"]);
    const [q1, q2] = rounds[0]!;
    expect(code(submit(r, a!, q1!.id, { type: "text", text: "x" }))).toBe("question_closed");
    host(r, "question.next");
    expect(code(r.engine.command(r.host, "question.next", {}))).toBe("wrong_phase");   // q1 not locked yet
    expect(code(submit(r, a!, q1!.id, { type: "text", text: "Fleetwod Mac" }))).toBe("ok");
    const again = submit(r, a!, q1!.id, { type: "text", text: "Fleetwood Mac" });
    expect(again).toEqual({ ok: true, result: { receivedAt: r.clock.now() } });
    expect(r.engine.answer(a!.teamId, q1!.id)!.changes).toBe(1);
    expect(submit(r, a!, q1!.id, { type: "text", text: "Fleetwood Mac" }).ok).toBe(true);   // same answer: no-op
    expect(r.engine.answer(a!.teamId, q1!.id)!.changes).toBe(1);
    expect(code(submit(r, a!, q1!.id, { type: "choice", index: 1 }))).toBe("bad_args");

    host(r, "timer.start");
    const t0 = r.engine.state.timer;
    expect(t0).toEqual({ state: "running", durationMs: 60_000, locksAt: r.clock.now() + 60_000, remainingMs: null });
    r.advance(20_000);
    host(r, "timer.pause");
    expect(r.engine.state.timer).toMatchObject({ state: "paused", remainingMs: 40_000, locksAt: null });
    r.advance(100_000);   // paused: nothing locks
    expect(r.engine.state.questions[q1!.id]!.status).toBe("open");
    host(r, "timer.add", { seconds: 15 });
    expect(r.engine.state.timer.remainingMs).toBe(55_000);
    expect(code(r.engine.command(r.host, "timer.add", { seconds: 30 }))).toBe("bad_args");
    host(r, "timer.resume");
    const locksAt = r.engine.state.timer.locksAt!;
    expect(locksAt).toBe(r.clock.now() + 55_000);
    r.advance(50_000);
    expect(r.engine.state.lines.question).toBe("last_seconds#0");
    r.advance(5_000);   // runs out
    expect(r.engine.state.questions[q1!.id]).toMatchObject({ status: "locked", lockedAt: locksAt });
    expect(r.engine.state.timer.state).toBe("done");
    expect(r.engine.answer(a!.teamId, q1!.id)!.mark).toBe("correct");
    expect(r.engine.answer(b!.teamId, q1!.id)).toMatchObject({ value: null, mark: "wrong", markedBy: "auto" });
    expect(r.engine.state.lines.locked).toBe("locked#0");
    expect(r.engine.teamFlash.get(b!.teamId)).toMatchObject({ key: "no_answer", teamId: b!.teamId });
    expect(teamView(r.engine, b!.teamId).flash?.key).toBe("no_answer");
    expect(teamView(r.engine, a!.teamId).flash).toBeNull();
    expect(displayView(r.engine).flash).toBeNull();
    expect(displayView(r.engine).lockedMoment).toEqual({ at: locksAt, all: false });

    host(r, "question.next");
    expect(r.engine.state.lines.locked).toBeNull();
    submit(r, a!, q2!.id, { type: "choice", index: 0 });
    submit(r, b!, q2!.id, { type: "choice", index: 2 });
    host(r, "lock");   // early, no timer
    expect(r.engine.state.lines.locked).toBe("all_locked#0");
    expect(host(r, "lock")).toBeUndefined();   // already locked: no-op ok
    expect([r.engine.answer(a!.teamId, q2!.id)!.mark, r.engine.answer(b!.teamId, q2!.id)!.mark]).toEqual(["correct", "wrong"]);
  });

  test("S-04: an answer 1 ms before locksAt counts, one at locksAt does not", () => {
    const { r, rounds } = setup();
    const [a, b] = start(r, ["A", "B"]);
    const q1 = rounds[0]![0]!;
    host(r, "question.next");
    host(r, "timer.start");
    const locksAt = r.engine.state.timer.locksAt!;
    r.clock.t = locksAt - 1;   // no scheduled job has run: only the check in answer.submit stands between
    expect(code(submit(r, a!, q1.id, { type: "text", text: "Fleetwood Mac" }))).toBe("ok");
    r.clock.t = locksAt;
    expect(code(submit(r, b!, q1.id, { type: "text", text: "Fleetwood Mac" }))).toBe("too_late");
    expect(r.engine.answer(b!.teamId, q1.id)).toBeUndefined();
    r.scheduler.runDue();
    expect(r.engine.state.questions[q1.id]!.status).toBe("locked");
    expect(code(submit(r, b!, q1.id, { type: "text", text: "Fleetwood Mac" }))).toBe("too_late");
    expect(r.engine.answer(a!.teamId, q1.id)!.mark).toBe("correct");
    expect(r.engine.answer(b!.teamId, q1.id)!.mark).toBe("wrong");
  });
});

describe("per-round lock mode", () => {
  test("earlier questions stay open; the round timer starts after the last question and locks them all", () => {
    const { r, rounds } = setup({ lockMode: "round", timerSeconds: 90 });
    const [a] = start(r, ["A", "B"]);
    const [q1, q2, q3] = rounds[0]!;
    host(r, "question.next");
    expect(code(r.engine.command(r.host, "timer.start", {}))).toBe("wrong_phase");
    expect(code(r.engine.command(r.host, "lock", {}))).toBe("wrong_phase");
    host(r, "question.next");
    host(r, "question.next");
    expect(code(r.engine.command(r.host, "question.next", {}))).toBe("wrong_phase");
    expect(submit(r, a!, q1!.id, { type: "text", text: "the fleetwood mac" }).ok).toBe(true);
    expect(teamView(r.engine, a!.teamId).questions.map((x) => x.id)).toEqual([q1!.id, q2!.id, q3!.id]);
    host(r, "timer.start");
    expect(r.engine.state.timer.durationMs).toBe(90_000);
    expect(teamView(r.engine, a!.teamId).questions.every((x) => x.timer.locksAt === r.engine.state.timer.locksAt)).toBe(true);
    submit(r, a!, q3!.id, { type: "number", value: 4 });
    r.advance(90_000);
    for (const x of [q1!, q2!, q3!]) expect(r.engine.state.questions[x.id]!.status).toBe("locked");
    expect(displayView(r.engine).lockedMoment).toMatchObject({ all: false });
    expect(r.engine.answer(a!.teamId, q1!.id)!.mark).toBe("correct");
    host(r, "round.finish");
    expect(r.engine.state.phase).toBe("marking");
  });
});

describe("marking (8.2, H-10, H-13)", () => {
  test("typed answers are grouped, mark.group adds the accepted answer to the snapshot and quiz store, disputes are logged", async () => {
    const { r, rounds } = setup();
    const [a, b, c] = start(r, ["A", "B", "C"]);
    const [q1, q2, q3] = rounds[0]!;
    host(r, "question.next");
    submit(r, a!, q1!.id, { type: "text", text: "Fleetwood Mac" });
    submit(r, b!, q1!.id, { type: "text", text: "The Mac" });
    submit(r, c!, q1!.id, { type: "text", text: "the mac!" });
    host(r, "lock");
    let mq = hostView(r.engine).marking!.questions[0]!;
    expect(mq.pending).toBe(2);
    expect(mq.groups.map((g) => [g.key, g.teamIds.length, g.mark])).toEqual([["fleetwood mac", 1, "correct"], ["mac", 2, "pending"]]);
    expect(hostView(r.engine).marking!.pendingTotal).toBe(2);
    host(r, "question.next");
    host(r, "lock");
    host(r, "question.next");
    host(r, "lock");
    host(r, "round.finish");
    expect(code(r.engine.command(r.host, "reveal.start", {}))).toBe("marks_pending");
    expect(code(r.engine.command(r.host, "leaderboard.show", {}))).toBe("marks_pending");
    expect(hostView(r.engine).can["reveal.start"]).toBe(false);
    expect(code(r.engine.command(r.host, "mark.group", { questionId: q1!.id, key: "nothing", mark: "correct" }))).toBe("not_found");
    host(r, "mark.group", { questionId: q1!.id, key: "mac", mark: "correct" });
    expect(r.engine.quiz.rounds[0]!.questions[0]!.answer).toEqual({ type: "text", accepted: ["Fleetwood Mac", "The Mac"] });
    await Bun.sleep(0);
    expect(r.saved).toEqual([["friday", q1!.id, "The Mac"]]);
    mq = hostView(r.engine).marking!.questions[0]!;
    expect(mq.pending).toBe(0);
    expect(hostView(r.engine).can["reveal.start"]).toBe(true);
    // a dispute: B was right, now wrong; then the empty answer on q2 marked right
    host(r, "mark.team", { questionId: q1!.id, teamId: b!.teamId, mark: "wrong" });
    host(r, "mark.team", { questionId: q2!.id, teamId: c!.teamId, mark: "correct" });
    const changes = r.engine["d"].db.query("SELECT team_id, question_id, from_mark, to_mark FROM mark_changes ORDER BY id").all();
    expect(changes).toEqual([
      { team_id: b!.teamId, question_id: q1!.id, from_mark: "correct", to_mark: "wrong" },
      { team_id: c!.teamId, question_id: q2!.id, from_mark: "wrong", to_mark: "correct" },
    ]);
    expect(code(r.engine.command(r.host, "mark.team", { questionId: q3!.id, teamId: "t-nobody00", mark: "correct" }))).toBe("not_found");
    // other types: one group per distinct value, already marked
    expect(hostView(r.engine).marking!.questions[2]!.noAnswer.length).toBe(3);
  });

  test("closest questions are marked together at the lock; missing answers are wrong", () => {
    const r = rig();
    rigs.push(r);
    const qc = q({ type: "closest", value: 100 });
    writeQuiz(r.dataDir, makeQuiz("friday", [[qc]]));
    const [a, b, c] = start(r, ["A", "B", "C"]);
    host(r, "question.next");
    submit(r, a!, qc.id, { type: "number", value: 90 });
    submit(r, b!, qc.id, { type: "number", value: 110 });
    host(r, "lock");
    expect([a, b, c].map((t) => r.engine.answer(t!.teamId, qc.id)!.mark)).toEqual(["correct", "correct", "wrong"]);
  });
});

describe("a whole night: reveal, leaderboard, halftime, joker, sudden death, Quiz End (S-06..S-08)", () => {
  test("plays through and writes results", () => {
    const { r, rounds, sd } = setup({ joker: true }, { rounds: 2, sd: 3 });
    host(r, "night.open", { quizId: "friday" });
    const a = joinTeam(r, "Alpha");
    const b = joinTeam(r, "Bravo");
    const c = joinTeam(r, "Charlie");
    // jokers (P-04)
    expect(code(r.engine.command(a, "joker.play", { round: 1 }))).toBe("joker_wrong_round");
    expect(code(r.engine.command(a, "joker.play", { round: 0 }))).toBe("ok");
    expect(r.engine.state.flash).toMatchObject({ key: "joker_played", teamId: a.teamId });
    expect(code(r.engine.command(a, "joker.play", { round: 0 }))).toBe("joker_used");
    expect(teamView(r.engine, a.teamId).self!.jokerAvailable).toBe(false);
    expect(teamView(r.engine, b.teamId).self!.jokerAvailable).toBe(true);
    host(r, "quiz.start");
    host(r, "round.start");
    expect(code(r.engine.command(b, "joker.play", { round: 0 }))).toBe("wrong_phase");

    // round 1: A gets 1 (x2 joker = 2), B gets 2, C gets 0
    const answers: Record<string, [string, object][]> = {
      [a.teamId]: [[rounds[0]![0]!.id, { type: "text", text: "Fleetwood Mac" }]],
      [b.teamId]: [[rounds[0]![1]!.id, { type: "choice", index: 0 }], [rounds[0]![2]!.id, { type: "number", value: 4 }]],
    };
    for (const qq of rounds[0]!) {
      host(r, "question.next");
      for (const t of [a, b, c]) for (const [qid, v] of answers[t.teamId] ?? []) if (qid === qq.id) submit(r, t, qid, v);
      host(r, "lock");
    }
    host(r, "round.finish");
    host(r, "reveal.start");
    expect(displayView(r.engine).reveal).toMatchObject({ answerText: "Fleetwood Mac", rightCount: 1 });
    expect(displayView(r.engine).lines.reveal).toBe("reveal#0");
    host(r, "reveal.next");
    expect(displayView(r.engine).reveal!.answerText).toBe("A. Paris");
    host(r, "reveal.next");
    host(r, "reveal.next");
    expect(r.engine.state.phase).toBe("leaderboard");
    const st = displayView(r.engine).standings!;
    expect(st.rows.map((x) => [x.name, x.total, x.position, x.decidedBy])).toEqual([
      ["Alpha", 2, 1, "shared"], ["Bravo", 2, 1, "shared"], ["Charlie", 0, 3, "points"],
    ]);
    expect(st.rows.find((x) => x.name === "Alpha")!.jokerThisRound).toBe(true);
    expect(st.rows.find((x) => x.name === "Alpha")!.roundScore).toBe(2);
    expect(st.rows.map((x) => x.prevPosition)).toEqual([null, null, null]);   // no round before the first

    // halftime after round 1 of 2 ("auto" = ceil(2/2))
    host(r, "round.next");
    expect(r.engine.state.phase).toBe("halftime");
    expect(displayView(r.engine).lines.halftime).toBe("halftime#0");
    expect(code(r.engine.command(b, "joker.play", { round: 1 }))).toBe("ok");
    host(r, "round.next");
    expect(r.engine.state.phase).toBe("round_intro");
    expect(r.engine.state.round).toBe(1);
    expect(displayView(r.engine).lines.round).toBe("round_start#1");

    // round 2: nobody scores, so Alpha and Bravo stay level on points and round wins
    host(r, "round.start");
    for (let i = 0; i < 3; i++) { host(r, "question.next"); host(r, "lock"); }
    host(r, "round.finish");
    host(r, "leaderboard.show");
    const rows = hostView(r.engine).standings!.rows;
    expect(rows.filter((x) => x.position === 1).map((x) => x.name)).toEqual(["Alpha", "Bravo"]);
    expect(rows.map((x) => x.prevPosition)).toEqual([1, 1, 3]);   // nobody moved since round 1
    expect(hostView(r.engine).suddenDeathNeeded).toEqual({ position: 1, teamIds: [a.teamId, b.teamId] });
    expect(code(r.engine.command(r.host, "round.next", {}))).toBe("wrong_phase");
    expect(hostView(r.engine).can["sd.start"]).toBe(true);

    // sudden death: only the tied teams answer; nobody right, then only Bravo right
    host(r, "sd.start");
    expect(displayView(r.engine).suddenDeath).toMatchObject({ position: 1, status: "waiting", maxQuestions: 3, question: null });
    expect(displayView(r.engine).lines.suddenDeath).toBe("sudden_death#0");
    host(r, "sd.ask");
    expect(teamView(r.engine, a.teamId).self!.inSuddenDeath).toBe(true);
    expect(teamView(r.engine, c.teamId).self!.inSuddenDeath).toBe(false);
    expect(code(submit(r, c, sd[0]!.id, { type: "choice", index: 1 }))).toBe("not_allowed");
    submit(r, a, sd[0]!.id, { type: "choice", index: 0 });
    expect(code(r.engine.command(r.host, "sd.reveal", {}))).toBe("wrong_phase");
    expect(code(r.engine.command(r.host, "quiz.end", {}))).toBe("wrong_phase");
    host(r, "timer.start");
    r.advance(60_000);
    expect(r.engine.state.sd!.current!.status).toBe("locked");
    host(r, "sd.reveal");
    expect(r.engine.state.lines.suddenDeath).toBe("sudden_death_again#0");
    expect(displayView(r.engine).suddenDeath!.rightIds).toEqual([]);
    host(r, "sd.ask");
    expect(displayView(r.engine).suddenDeath!.questionNumber).toBe(2);
    submit(r, a, sd[1]!.id, { type: "choice", index: 2 });
    submit(r, b, sd[1]!.id, { type: "choice", index: 1 });
    host(r, "lock");
    host(r, "sd.reveal");
    expect(r.engine.state.lines.suddenDeath).toBe("sudden_death_won#0 Bravo");
    expect(displayView(r.engine).suddenDeath!.outcome).toEqual({ position: 1, teamIds: [b.teamId], result: "won" });
    expect(code(r.engine.command(r.host, "sd.ask", {}))).toBe("wrong_phase");   // scope "first": nothing more to decide

    host(r, "quiz.end");
    expect(r.engine.state.phase).toBe("ended");
    const fin = displayView(r.engine);
    expect(fin.final).toEqual({
      winners: [{ id: b.teamId, name: "Bravo", colour: expect.any(Number), jokerThisRound: true }],
      lastPlace: [{ id: c.teamId, name: "Charlie", colour: expect.any(Number), jokerThisRound: false }],
      standingsAt: r.clock.now() + 15_000,   // venue default: afterWinner timer, 15 s
    });
    // afterWinner timer: the host may skip ahead until the time comes; then the final standings show by themselves
    expect(hostView(r.engine).finalStandingsAt).toBe(r.clock.now() + 15_000);
    expect(hostView(r.engine).can["final.show"]).toBe(true);
    const seq = r.engine.state.seq;
    r.advance(15_000);
    expect(r.engine.state.seq).toBeGreaterThan(seq);   // fresh views sent at the switch
    expect(hostView(r.engine).can["final.show"]).toBe(false);
    expect(code(r.engine.command(r.host, "final.show", {}))).toBe("wrong_phase");
    expect(fin.lines).toMatchObject({ winner: "winner#0 Bravo", lastPlace: "last_place#0 Charlie", goodbye: "goodbye#0" });
    const results = r.engine["d"].db.query("SELECT team_id, position, decided_by, total FROM results ORDER BY position").all();
    expect(results).toEqual([
      { team_id: b.teamId, position: 1, decided_by: "sudden_death", total: 2 },
      { team_id: a.teamId, position: 2, decided_by: "sudden_death", total: 2 },
      { team_id: c.teamId, position: 3, decided_by: "points", total: 0 },
    ]);
    const night = r.engine["d"].db.query("SELECT status, end_reason FROM nights").get();
    expect(night).toEqual({ status: "ended", end_reason: "finished" });
    host(r, "night.close");
    expect(r.engine.m).toBeNull();
    expect(displayView(r.engine).phase).toBe("idle");
    expect(r.engine.teamForToken(a.token)).toBeNull();
  });

  test("quiz.end early from the middle of a round; night.close from the lobby keeps the night as early", () => {
    const { r } = setup();
    const [a] = start(r, ["A"]);
    host(r, "question.next");
    expect(code(r.engine.command(r.host, "quiz.end", {}))).toBe("wrong_phase");
    host(r, "quiz.end", { early: true });
    expect(r.engine.m!.night).toMatchObject({ status: "ended", endReason: "early" });
    expect(Object.values(r.engine.state.questions).some((x) => x.status === "open")).toBe(false);
    void a;
    host(r, "night.close");
    host(r, "night.open", { quizId: "friday" });
    host(r, "night.close");
    const rows = r.engine["d"].db.query("SELECT status, end_reason FROM nights ORDER BY opened_at").all();
    expect(rows).toEqual([{ status: "ended", end_reason: "early" }, { status: "ended", end_reason: "early" }]);
  });
});

describe("after the winner (venue afterWinner) and leaderboard movement", () => {
  test("host mode: the winner stays until final.show; the command is refused before Quiz End", () => {
    const { r } = setup();
    writeFileSync(join(r.dataDir, "venue.json"), JSON.stringify({ format: "lockin.venue/1", afterWinner: { mode: "host", seconds: 15 } }));
    r.engine.venueChanged();
    start(r, ["A", "B"]);
    expect(code(r.engine.command(r.host, "final.show", {}))).toBe("wrong_phase");
    expect(hostView(r.engine).finalStandingsAt).toBeNull();
    host(r, "quiz.end", { early: true });
    expect(displayView(r.engine).final!.standingsAt).toBeNull();
    expect(hostView(r.engine).can["final.show"]).toBe(true);
    r.advance(600_000);
    expect(displayView(r.engine).final!.standingsAt).toBeNull();   // no timer in host mode
    host(r, "final.show");
    expect(displayView(r.engine).final!.standingsAt).toBe(r.clock.now());
    expect(hostView(r.engine).finalStandingsAt).toBe(r.clock.now());
    expect(code(r.engine.command(r.host, "final.show", {}))).toBe("wrong_phase");
  });

  test("timer mode uses the venue's seconds", () => {
    const { r } = setup();
    writeFileSync(join(r.dataDir, "venue.json"), JSON.stringify({ format: "lockin.venue/1", afterWinner: { mode: "timer", seconds: 40 } }));
    r.engine.venueChanged();
    start(r, ["A"]);
    host(r, "quiz.end", { early: true });
    expect(displayView(r.engine).final!.standingsAt).toBe(r.clock.now() + 40_000);
  });

  test("prevPosition: places after the round before, so a team that overtakes moves up", () => {
    const { r, rounds } = setup({}, { rounds: 2 });
    const [a, b] = start(r, ["Alpha", "Bravo"]);
    // round 1: only Alpha scores
    for (const qq of rounds[0]!) {
      host(r, "question.next");
      if (qq === rounds[0]![0]) submit(r, a!, qq.id, { type: "text", text: "Fleetwood Mac" });
      host(r, "lock");
    }
    host(r, "round.finish");
    host(r, "leaderboard.show");
    expect(displayView(r.engine).standings!.rows.map((x) => [x.name, x.position, x.prevPosition])).toEqual([["Alpha", 1, null], ["Bravo", 2, null]]);
    host(r, "round.next");
    if (r.engine.state.phase === "halftime") host(r, "round.next");
    host(r, "round.start");
    // round 2: Bravo gets two right and overtakes
    for (const qq of rounds[1]!) {
      host(r, "question.next");
      if (qq === rounds[1]![1]) submit(r, b!, qq.id, { type: "choice", index: 0 });
      if (qq === rounds[1]![2]) submit(r, b!, qq.id, { type: "number", value: 4 });
      host(r, "lock");
    }
    host(r, "round.finish");
    host(r, "leaderboard.show");
    expect(displayView(r.engine).standings!.rows.map((x) => [x.name, x.position, x.prevPosition])).toEqual([["Bravo", 1, 2], ["Alpha", 2, 1]]);
  });
});

describe("write-through and restart recovery (6.3, 7.6)", () => {
  test("a new engine on the same database has every answer, mark and score back", () => {
    const { r, rounds } = setup({ joker: true });
    host(r, "night.open", { quizId: "friday" });
    const a = joinTeam(r, "A");
    const b = joinTeam(r, "B");
    r.engine.command(a, "joker.play", { round: 0 });
    host(r, "quiz.start");
    host(r, "round.start");
    host(r, "question.next");
    submit(r, a, rounds[0]![0]!.id, { type: "text", text: "Fleetwood Mac" });
    submit(r, b, rounds[0]![0]!.id, { type: "text", text: "Fleetwood" });
    host(r, "lock");
    host(r, "mark.team", { questionId: rounds[0]![0]!.id, teamId: b.teamId, mark: "correct" });
    host(r, "question.next");
    submit(r, a, rounds[0]![1]!.id, { type: "choice", index: 3 });
    const before = { host: hostView(r.engine), a: teamView(r.engine, a.teamId), display: displayView(r.engine), answers: [...r.engine.m!.answers.values()] };
    const r2 = r.restart();
    rigs.push(r2);
    rigs.splice(rigs.indexOf(r), 1);
    const byKey = (xs: { teamId: string; questionId: string }[]) => [...xs].sort((x, y) => `${x.teamId}${x.questionId}`.localeCompare(`${y.teamId}${y.questionId}`));
    expect(byKey([...r2.engine.m!.answers.values()])).toEqual(byKey(before.answers));
    expect(hostView(r2.engine)).toEqual(before.host);
    expect(teamView(r2.engine, a.teamId)).toEqual(before.a);
    expect(displayView(r2.engine)).toEqual(before.display);
    expect(r2.engine.teamForToken(a.token)).toBe(a.teamId);
    expect(hostView(r2.engine).standings!.rows.map((x) => x.total)).toEqual([2, 1]);
    // carries on
    host(r2, "lock");
    expect(r2.engine.answer(a.teamId, rounds[0]![1]!.id)!.mark).toBe("wrong");
  });

  test("a timer that ran out while the server was down locks at once; answers stored before count", () => {
    const { r, rounds } = setup();
    const [a, b] = start(r, ["A", "B"]);
    const q1 = rounds[0]![0]!;
    host(r, "question.next");
    host(r, "timer.start");
    const locksAt = r.engine.state.timer.locksAt!;
    r.clock.t = locksAt - 5;
    submit(r, a!, q1.id, { type: "text", text: "Fleetwood Mac" });
    r.clock.t = locksAt + 30_000;   // down past the lock
    const r2 = r.restart();
    rigs.splice(rigs.indexOf(r), 1, r2);
    expect(r2.engine.state.questions[q1.id]).toMatchObject({ status: "locked", lockedAt: locksAt });
    expect(r2.engine.answer(a!.teamId, q1.id)!.mark).toBe("correct");
    expect(r2.engine.answer(b!.teamId, q1.id)!.mark).toBe("wrong");
    expect(code(submit(r2, b!, q1.id, { type: "text", text: "Fleetwood Mac" }))).toBe("too_late");
  });

  test("a timer still running after a restart is rescheduled", () => {
    const { r, rounds } = setup();
    start(r, ["A"]);
    host(r, "question.next");
    host(r, "timer.start");
    r.advance(10_000);
    const r2 = r.restart();
    rigs.splice(rigs.indexOf(r), 1, r2);
    const qid = rounds[0]![0]!.id;
    expect(r2.engine.state.questions[qid]!.status).toBe("open");
    r2.advance(50_000);
    expect(r2.engine.state.questions[qid]!.status).toBe("locked");
  });

  test("if the write fails, the command fails and memory goes back to the last written state", () => {
    const { r, rounds } = setup();
    const [a] = start(r, ["A"]);
    host(r, "question.next");
    const seq = r.engine.seq;
    r.engine["d"].db.exec("CREATE TRIGGER no_answers BEFORE INSERT ON answers BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    expect(() => submit(r, a!, rounds[0]![0]!.id, { type: "text", text: "x" })).toThrow("disk full");
    expect(r.engine.answer(a!.teamId, rounds[0]![0]!.id)).toBeUndefined();
    expect(r.engine.seq).toBe(seq);
    r.engine["d"].db.exec("DROP TRIGGER no_answers");
    expect(submit(r, a!, rounds[0]![0]!.id, { type: "text", text: "x" }).ok).toBe(true);
  });
});

describe("views (10.3, 10.4)", () => {
  /** Every key anywhere in a JSON value. */
  function keys(v: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(v)) for (const x of v) keys(x, out);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keys(x, out); }
    return out;
  }

  test("through a whole night the display never carries answers and a team sees only its own; views match the fixtures' shape", async () => {
    const fixtures = await loadFixtures();
    const { r, rounds, sd } = setup({ joker: true }, { rounds: 2, sd: 2 });
    const seen: View[] = [];
    const snap = () => {
      seen.push(displayView(r.engine), hostView(r.engine));
      for (const t of r.engine.teams()) seen.push(teamView(r.engine, t.id));
      seen.push(teamView(r.engine, null));
    };
    snap();
    host(r, "night.open", { quizId: "friday" });
    const a = joinTeam(r, "Alpha");
    const b = joinTeam(r, "Bravo");
    snap();
    host(r, "quiz.start"); snap();
    for (let round = 0; round < 2; round++) {
      host(r, "round.start"); snap();
      for (const qq of rounds[round]!) {
        host(r, "question.next");
        const v = qq.answer.type === "text" ? { type: "text", text: "SecretAnswerAlpha" } : qq.answer.type === "choice" ? { type: "choice", index: 0 } : { type: "number", value: 4 };
        submit(r, a, qq.id, v);
        submit(r, b, qq.id, qq.answer.type === "text" ? { type: "text", text: "SecretAnswerBravo" } : v);
        snap();
        host(r, "lock"); snap();
        if (qq.answer.type === "text") {
          host(r, "mark.group", { questionId: qq.id, key: "secretansweralpha", mark: "correct" });
          host(r, "mark.group", { questionId: qq.id, key: "secretanswerbravo", mark: "correct" });
        }
      }
      host(r, "round.finish"); snap();
      host(r, "reveal.start"); snap();
      host(r, "leaderboard.show"); snap();
      if (round === 0) { host(r, "round.next"); snap(); host(r, "round.next"); snap(); }
    }
    host(r, "sd.start"); snap();
    host(r, "sd.ask");
    submit(r, b, sd[0]!.id, { type: "choice", index: 1 });
    snap();
    host(r, "lock"); snap();
    host(r, "sd.reveal"); snap();
    host(r, "quiz.end"); snap();

    const phases = new Set<string>();
    for (const v of seen) {
      phases.add(`${v.role}/${v.phase}`);
      const json = JSON.stringify(v);
      if (v.role === "display") {
        const k = keys(v);
        for (const banned of ["answer", "accepted", "note", "groups", "rejoinCode", "answers", "marking"]) expect(`${banned}:${k.has(banned)}`).toBe(`${banned}:false`);
        expect(json).not.toContain("SecretAnswer");
      }
      if (v.role === "team") {
        const self = (v as TeamView).self;
        if (self?.name !== "Alpha") expect(json).not.toContain("SecretAnswerAlpha");
        if (self?.name !== "Bravo") expect(json).not.toContain("SecretAnswerBravo");
        expect(keys(v).has("accepted")).toBe(false);
        for (const ans of (v as TeamView).answers) expect(r.engine.answer(self!.id, ans.questionId)).toBeDefined();
      }
      // same top-level shape as B0's fixture for this role and phase
      const fixture = fixtures.get(`${v.role}/${v.phase}`)!;
      expect(`${v.role}/${v.phase}: ${Object.keys(v).sort().join(",")}`).toBe(`${v.role}/${v.phase}: ${Object.keys(fixture).sort().join(",")}`);
      if (v.night && fixture.night) expect(Object.keys(v.night).sort()).toEqual(Object.keys(fixture.night).sort());
    }
    for (const role of ["host", "display", "team"]) {
      for (const phase of ["idle", "lobby", "round_intro", "asking", "marking", "reveal", "leaderboard", "halftime", "sudden_death", "ended"]) {
        expect(phases.has(`${role}/${phase}`)).toBe(true);
      }
    }
    // the host sees answers and buttons
    const h = seen.find((v) => v.role === "host" && v.phase === "asking" && (v as HostView).current) as HostView;
    expect(h.current!.answer).toBeDefined();
    expect(h.can["lock"]).toBe(true);
    expect((seen.find((v) => v.role === "display" && v.phase === "asking" && (v as DisplayView).question) as DisplayView).question!.answered).toBeGreaterThan(0);
  });

  test("copy lines: the lobby line renews every 45 s and a pool never repeats its last line", () => {
    const { r } = setup();
    host(r, "night.open", { quizId: "friday" });
    const seen: string[] = [displayView(r.engine).lines.lobby!];
    for (let i = 0; i < 4; i++) { r.advance(45_000); seen.push(displayView(r.engine).lines.lobby!); }
    expect(seen).toEqual(["lobby#0", "lobby#1", "lobby#2", "lobby#0", "lobby#1"]);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(r.copy.calls.filter((c) => c.key === "lobby").every((c) => (c.vars as { pub: string }).pub === "Lock-In")).toBe(true);
  });

  test("without a copy picker or rules, screens show no line and standings are left out", () => {
    const r = rig({ rules: undefined });
    rigs.push(r);
    writeQuiz(r.dataDir, makeQuiz("friday", [[q(number(1))]]));
    expect(() => r.engine.command(r.host, "night.open", { quizId: "friday" })).toThrow("rules");
    expect(r.engine.m).toBeNull();
  });
});
