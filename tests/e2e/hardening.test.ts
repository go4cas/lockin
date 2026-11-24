// B9 hardening (TECH-SPEC 12, 7.6, 11): abuse and failure cases against a real
// server process: wrong roles, bad answers, brute-forced rejoin codes, oversize
// frames, answer floods, a reconnect storm, and kills at awkward moments.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { COMMAND_NAMES, TEAM_COMMANDS, type HostView, type TeamView } from "../../src/shared/protocol.ts";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type Question, type QuizFile } from "../../src/shared/formats.ts";
import { writeQuiz } from "../night/fakes.ts";
import { tempDataDir } from "../helpers/process.ts";
import { Night, code, ok, waitFor } from "./driver.ts";

function quiz(id: string, extra: Partial<QuizFile["settings"]> = {}): QuizFile {
  const qs = (r: number): Question[] => [
    { id: `q-h${r}a00000`, text: "Typed?", answer: { type: "text", accepted: ["right"] } },
    { id: `q-h${r}b00000`, text: "Pick?", answer: { type: "choice", options: ["A", "B", "C"], correct: 1 } },
    { id: `q-h${r}c00000`, text: "How many?", answer: { type: "number", value: 3 }, timerSeconds: 10 },
  ];
  return {
    format: QUIZ_FORMAT, id, title: `Hardening ${id}`, updatedAt: "2026-11-24T10:00:00.000Z",
    settings: { ...DEFAULT_QUIZ_SETTINGS, ...extra },
    rounds: [0, 1].map((r) => ({ id: `r-h000000${r}`, title: `Round ${r + 1}`, questions: qs(r) })),
    suddenDeath: [],
  };
}

const dirs: string[] = [];
const nights: Night[] = [];
afterEach(async () => { while (nights.length) await nights.pop()!.stop(); });
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function openNight(q: QuizFile, teams: number): Promise<{ night: Night; roomCode: string }> {
  const dataDir = tempDataDir("lockin-hard-");
  dirs.push(dataDir);
  writeQuiz(dataDir, q);
  const night = new Night(dataDir);
  nights.push(night);
  await night.start();
  const { roomCode } = await night.cmd("night.open", { quizId: q.id }) as { roomCode: string };
  for (let t = 0; t < teams; t++) await night.join(roomCode, `Team ${t + 1}`);
  return { night, roomCode };
}

describe("roles and input", () => {
  test("team and display connections can run no host command; bad answers are refused", async () => {
    const q = quiz("roles");
    const { night, roomCode } = await openNight(q, 2);
    const team = night.phones[0]!.c;
    const unbound = await night.client("team", "unbound");
    for (const [i, name] of COMMAND_NAMES.filter((n) => !TEAM_COMMANDS.includes(n)).entries()) {
      if (i % 8 === 7) await Bun.sleep(1000);   // stay under the per-socket message limit (SA-04: 20, then 10 a second)
      expect([name, await code(team, name, {})]).toEqual([name, "not_allowed"]);
      expect([name, await code(night.display, name, {})]).toEqual([name, "not_allowed"]);
      expect([name, await code(unbound, name, {})]).toEqual([name, "not_allowed"]);
    }
    expect(await code(night.display, "answer.submit", { questionId: q.rounds[0]!.questions[0]!.id, value: { type: "text", text: "x" } })).toBe("not_allowed");

    await night.cmd("quiz.start");
    await night.cmd("round.start");
    await night.cmd("question.next");
    const [qa, qb] = q.rounds[0]!.questions;
    // not yet shown, another round, unknown, wrong type, too long, empty, not a number, out of range
    const bad: [object, string][] = [
      [{ questionId: qb!.id, value: { type: "choice", index: 1 } }, "question_closed"],
      [{ questionId: q.rounds[1]!.questions[0]!.id, value: { type: "text", text: "x" } }, "question_closed"],
      [{ questionId: "q-nope0000", value: { type: "text", text: "x" } }, "not_found"],
      [{ questionId: qa!.id, value: { type: "choice", index: 0 } }, "bad_args"],
      [{ questionId: qa!.id, value: { type: "text", text: "x".repeat(101) } }, "bad_args"],
      [{ questionId: qa!.id, value: { type: "text", text: "   " } }, "bad_args"],
      [{ questionId: qa!.id, value: { type: "text", text: 42 } }, "bad_args"],
      [{ questionId: qa!.id }, "bad_args"],
      [{ questionId: qa!.id, value: null }, "bad_args"],
      [{}, "bad_args"],
    ];
    for (const [args, want] of bad) {
      const got = await code(team, "answer.submit", args);
      expect({ args, got }).toEqual({ args, got: expect.stringMatching(want === "question_closed" || want === "not_found" ? /question_closed|not_found|wrong_phase/ : /bad_args/) });
    }
    // the unbound phone cannot answer, and a bound phone cannot answer for another team (no teamId arg is honoured)
    expect(await code(unbound, "answer.submit", { questionId: qa!.id, value: { type: "text", text: "x" } })).not.toBe("ok");
    await ok(team, "answer.submit", { questionId: qa!.id, value: { type: "text", text: "mine" }, teamId: night.phones[1]!.teamId });
    await waitFor<HostView>(night.host, (v) => v.current!.answered === 1, "one answer");
    expect(night.hostView().teams.find((t) => t.id === night.phones[1]!.teamId)!.answeredCurrent).toBe(false);
    expect(night.teamView("Team 2").answers).toEqual([]);
    // late joiner
    const late = await night.client("team", "late");
    expect(await code(late, "team.join", { roomCode, name: "Too Late" })).toBe("joining_closed");
  });

  test("a full night refuses the next team; rejoin codes lock out after 5 wrong tries", async () => {
    const q = quiz("full", { maxTeams: 2 });
    const { night, roomCode } = await openNight(q, 2);
    const third = await night.client("team", "third");
    expect(await code(third, "team.join", { roomCode, name: "Third" })).toBe("night_full");
    const guesser = await night.client("team", "guesser");
    for (let i = 0; i < 5; i++) expect(await code(guesser, "team.rejoin", { code: "ZZZZZZ" })).toBe("bad_code");
    const real = night.teamView("Team 1").self!.rejoinCode;
    expect(await code(guesser, "team.rejoin", { code: real })).toBe("too_many_tries");
    // a different connection is not locked out
    const other = await night.client("team", "other");
    expect(await code(other, "team.rejoin", { code: real.toLowerCase() })).toBe("ok");
  });

  test("REVIEW finding 5: reconnecting does not reset the rejoin limit; it counts per client IP", async () => {
    const { night } = await openNight(quiz("rejoin-ip"), 2);
    const ip = { "CF-Connecting-IP": "203.0.113.7" };
    // 10 wrong tries a minute from one address, spread over fresh connections (2 each, below the per-connection 5)
    for (let i = 0; i < 5; i++) {
      const g = await night.client("team", `guesser-${i}`, undefined, ip);
      for (let k = 0; k < 2; k++) expect(await code(g, "team.rejoin", { code: "ZZZZZZ" })).toBe("bad_code");
      g.close();
    }
    const real = night.teamView("Team 1").self!.rejoinCode;
    const again = await night.client("team", "guesser-new", undefined, ip);
    expect(await code(again, "team.rejoin", { code: real })).toBe("too_many_tries");
    // another client address is not affected
    const elsewhere = await night.client("team", "elsewhere", undefined, { "CF-Connecting-IP": "198.51.100.9" });
    expect(await code(elsewhere, "team.rejoin", { code: real })).toBe("ok");
  });

  test("an oversize frame closes only that connection", async () => {
    const { night } = await openNight(quiz("big"), 1);
    const c = night.phones[0]!.c;
    c.sendRaw(JSON.stringify({ t: "cmd", id: 99, name: "answer.submit", args: { pad: "x".repeat(70 * 1024) } }));
    expect(await Promise.race([c.closed, Bun.sleep(3000).then(() => -1)])).not.toBe(-1);
    expect((await night.p.fetch("/api/ping")).status).toBe(200);
    expect(await code(night.host, "night.update", { plannedStart: null })).toBe("ok");
  });
});

describe("load and failure", () => {
  test("an answer flood from one phone is cut off and does not slow the host's counts for the others", async () => {
    const q = quiz("flood");
    const { night } = await openNight(q, 10);
    await night.cmd("quiz.start");
    await night.cmd("round.start");
    await night.cmd("question.next");
    const qid = q.rounds[0]!.questions[0]!.id;
    const flooder = night.phones[0]!.c;
    // 2,000 answer changes as fast as the socket takes them: SA-04 closes the socket after the burst
    const flood = Promise.all(Array.from({ length: 2000 }, (_, i) =>
      flooder.cmd("answer.submit", { questionId: qid, value: { type: "text", text: `spam ${i}` } }).catch(() => null)));
    await Bun.sleep(50);
    const t0 = Date.now();
    await Promise.all(night.phones.slice(1).map((p, i) => ok(p.c, "answer.submit", { questionId: qid, value: { type: "text", text: `honest ${i}` } })));
    await waitFor<HostView>(night.host, (v) => v.current!.answered === 10, "10 answers", 5000);
    const ms = Date.now() - t0;
    void flood;   // the rest never get an answer: the socket is closed
    const accepted = flooder.received.filter((m) => m.t === "ack" && m.ok).length;
    console.log(`[hardening] flood: 2000 changes from one phone, ${accepted} accepted before it was cut off; the other 9 answers counted on the host in ${ms} ms`);
    expect(accepted).toBeLessThanOrEqual(20);
    expect(flooder.received.some((m) => m.t === "bye" && m.reason === "protocol")).toBe(true);
    expect(ms).toBeLessThan(1000);
    expect(night.hostView().teams.find((t) => t.id === night.phones[0]!.teamId)).toBeTruthy();   // the team itself is kept
  }, 30_000);

  test("a reconnect storm: 30 phones drop and come back at once, all rebind with their answers", async () => {
    const q = quiz("storm", { maxTeams: 30 });
    const { night } = await openNight(q, 30);
    await night.cmd("quiz.start");
    await night.cmd("round.start");
    await night.cmd("question.next");
    const qid = q.rounds[0]!.questions[0]!.id;
    await Promise.all(night.phones.map((p, i) => ok(p.c, "answer.submit", { questionId: qid, value: { type: "text", text: `a${i}` } })));
    for (const p of night.phones) p.c.close();
    await waitFor<HostView>(night.host, (v) => v.teams.every((t) => !t.connected), "all offline");
    await Promise.all(night.phones.map(async (p) => { p.c = await night.client("team", p.name, p.token); }));
    await waitFor<HostView>(night.host, (v) => v.teams.every((t) => t.connected), "all back");
    for (const [i, p] of night.phones.entries()) {
      const v = night.teamView(p.name) as TeamView;
      expect(v.self!.id).toBe(p.teamId);
      expect(v.answers.map((a) => a.value)).toEqual([{ type: "text", text: `a${i}` }]);
    }
  }, 30_000);

  test("killed while the timer runs out: on restart the question is locked and later answers are too late", async () => {
    const q = quiz("expire");
    const { night } = await openNight(q, 2);
    for (const c of ["quiz.start", "round.start", "question.next", "lock", "question.next", "lock", "question.next", "timer.start"]) await night.cmd(c);
    const qc = q.rounds[0]!.questions[2]!;
    await ok(night.phones[0]!.c, "answer.submit", { questionId: qc.id, value: { type: "number", value: 3 } });
    const locksAt = night.hostView().current!.timer.locksAt!;
    await night.p.kill();
    await Bun.sleep(Math.max(0, locksAt - Date.now() + 200));   // down until after locksAt
    await night.killAndRestart();   // (kill is a no-op on the dead process)
    const hv = night.hostView();
    expect(hv.current!.status).toBe("locked");
    expect(await code(night.phones[1]!.c, "answer.submit", { questionId: qc.id, value: { type: "number", value: 3 } })).toBe("too_late");
    await night.cmd("round.finish");
    await waitFor<HostView>(night.host, (v) => v.marking!.questions.length === 3, "marking");
    const row = night.hostView().marking!.questions[2]!.groups;
    expect(row).toEqual([expect.objectContaining({ teamIds: [night.phones[0]!.teamId], mark: "correct" })]);
  }, 30_000);

  test("killed during marking and at the leaderboard: marks, dispute changes and jokers survive", async () => {
    const q = quiz("marks", { joker: true });
    const { night } = await openNight(q, 2);
    await ok(night.phones[1]!.c, "joker.play", { round: 0 });
    for (const c of ["quiz.start", "round.start", "question.next"]) await night.cmd(c);
    const [qa] = q.rounds[0]!.questions;
    await ok(night.phones[0]!.c, "answer.submit", { questionId: qa!.id, value: { type: "text", text: "rite" } });
    await ok(night.phones[1]!.c, "answer.submit", { questionId: qa!.id, value: { type: "text", text: "nope" } });
    for (const c of ["lock", "question.next", "lock", "question.next", "lock", "round.finish"]) await night.cmd(c);
    const g = night.hostView().marking!.questions[0]!.groups.find((x) => x.display === "rite")!;
    await ok(night.host, "mark.group", { questionId: qa!.id, key: g.key, mark: "correct" });
    await night.killAndRestart();
    let hv = night.hostView();
    expect(hv.phase).toBe("marking");
    expect(hv.marking!.pendingTotal).toBe(1);
    const g2 = hv.marking!.questions[0]!.groups.find((x) => x.display === "nope")!;
    await ok(night.host, "mark.group", { questionId: qa!.id, key: g2.key, mark: "wrong" });
    await night.cmd("leaderboard.show");
    await ok(night.host, "mark.team", { questionId: qa!.id, teamId: night.phones[1]!.teamId, mark: "correct" });   // dispute
    await night.killAndRestart();
    hv = night.hostView();
    expect(hv.phase).toBe("leaderboard");
    expect(hv.standings!.rows.map((r) => [r.name, r.total])).toEqual([["Team 2", 2], ["Team 1", 1]]);   // joker doubles Team 2
    expect(hv.teams.find((t) => t.id === night.phones[1]!.teamId)!.jokerRound).toBe(0);
  }, 30_000);
});
