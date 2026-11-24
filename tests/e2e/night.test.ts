// B9 end-to-end (TECH-SPEC 13.4): a full night in each lock mode against a real
// server process: joker, marking, a dispute change, halftime, a tie decided by
// sudden death, Quiz End and history, plus SIGKILL and restart of the server
// process mid-question with no lost answer, mark or score. Every display and
// team view received is checked against the privacy rules (10.3).
//
// Runs the source by default; LOCKIN_BIN=dist/lockin-linux-x64 runs the built binary.

import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type AnswerSpec, type Question, type QuizFile } from "../../src/shared/formats.ts";
import type { DisplayView, HistoryDetail, HostView, TeamView } from "../../src/shared/protocol.ts";
import type { AnswerValue } from "../../src/shared/rules-api.ts";
import { writeQuiz } from "../night/fakes.ts";
import { PrivacyWatch } from "../helpers/privacy.ts";
import { tempDataDir } from "../helpers/process.ts";
import { Night, code, ok, waitFor } from "./driver.ts";

const OPTIONS = ["Paris", "Rome", "Oslo", "Bern"];
const TEAMS = ["Alpha", "Bravo", "Charlie", "Delta"] as const;
type TeamName = (typeof TEAMS)[number];

let n = 0;
function question(answer: AnswerSpec, extra: Partial<Question> = {}): Question {
  n++;
  return { id: `q-e2e${String(n).padStart(5, "0")}`, text: `End-to-end question ${n}?`, note: `hostnote${n}x`, answer, ...extra };
}
const text = (r: number, i: number): AnswerSpec => ({ type: "text", accepted: [`ans${r}x${i}z`] });
const choice = (correct: number): AnswerSpec => ({ type: "choice", options: OPTIONS, correct });
const num = (value: number): AnswerSpec => ({ type: "number", value });

/** 4 rounds of 3 (halftime after round 2), joker on, 3 sudden-death questions. */
function makeQuiz(id: string, lockMode: "question" | "round"): QuizFile {
  const rounds: Question[][] = [
    [question(text(1, 1)), question(choice(1)), question(num(42), { timerSeconds: 10 })],
    [question(text(2, 1)), question({ type: "closest", value: 100 }), question({ type: "datetime", precision: "year", value: "1969", scoring: "exact" })],
    [question(text(3, 1)), question(choice(2)), question(num(7))],
    [question(text(4, 1)), question(choice(3)), question(num(12))],
  ];
  return {
    format: QUIZ_FORMAT, id, title: `E2E ${lockMode}`, updatedAt: "2026-11-24T10:00:00.000Z",
    settings: { ...DEFAULT_QUIZ_SETTINGS, lockMode, timerSeconds: 30, halftimeAfterRound: "auto", joker: true, suddenDeathScope: "first", suddenDeathMax: 3 },
    rounds: rounds.map((qs, i) => ({ id: `r-e2e0000${i}`, title: `Round ${i + 1}`, questions: qs })),
    suddenDeath: [question(choice(1)), question({ type: "text", accepted: ["sdans2z"] }), question(choice(0))],
  };
}

/** What a team sends for a question, and whether it should end up right. */
interface Plan { value: AnswerValue; right: boolean }
function rightValue(spec: AnswerSpec): AnswerValue {
  switch (spec.type) {
    case "text": return { type: "text", text: spec.accepted[0]! };
    case "choice": return { type: "choice", index: spec.correct };
    case "number": case "closest": return { type: "number", value: spec.value };
    case "datetime": return { type: "datetime", value: spec.value };
  }
}
function wrongValue(spec: AnswerSpec, team: string, qid: string): AnswerValue {
  switch (spec.type) {
    case "text": return { type: "text", text: `wrong${team.toLowerCase()}${qid.slice(-3)}` };
    case "choice": return { type: "choice", index: (spec.correct + 1) % spec.options.length };
    case "number": return { type: "number", value: spec.value + 1 };
    case "closest": return { type: "number", value: spec.value - 50 };
    case "datetime": return { type: "datetime", value: "1970" };
  }
}

/**
 * Alpha and Bravo are right on everything (Bravo's round-1 text answer differs
 * from the accepted one and is marked right by hand) so they tie on total and
 * round wins. Charlie plays the joker on round 2 and gets all of it right, plus
 * round 4 question 1; its round-1 text answer is marked wrong and then changed to
 * right as a dispute. Delta sends nothing in round 1 and is wrong after that.
 */
function plan(quiz: QuizFile, r: number, i: number, team: TeamName): Plan | null {
  const qq = quiz.rounds[r]!.questions[i]!;
  const right = (): Plan => ({ value: rightValue(qq.answer), right: true });
  const wrong = (): Plan => ({ value: wrongValue(qq.answer, team, qq.id), right: false });
  if (team === "Alpha") return right();
  if (team === "Bravo") return r === 0 && i === 0 ? { value: { type: "text", text: "ans 1x1z" }, right: true } : right();
  if (team === "Charlie") {
    if (r === 0 && i === 0) return { value: { type: "text", text: "charliesguess" }, right: false };
    return r === 1 || (r === 3 && i === 0) ? right() : wrong();
  }
  return r === 0 ? null : wrong();
}

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

for (const lockMode of ["question", "round"] as const) {
  describe(`a full night in ${lockMode} mode against the real server process`, () => {
    test("joker, marking, dispute, halftime, tie, sudden death, Quiz End, history, kill -9 mid-question", async () => {
      const dataDir = tempDataDir();
      dirs.push(dataDir);
      const quiz = makeQuiz(`e2e-${lockMode}`, lockMode);
      writeQuiz(dataDir, quiz);

      const watch = new PrivacyWatch();
      for (const qq of [...quiz.rounds.flatMap((r) => r.questions), ...quiz.suddenDeath]) {
        if (qq.answer.type === "text") for (const a of qq.answer.accepted) watch.secret(a, qq.id);
        watch.secret(qq.note!);   // host notes are never public
      }

      const night = new Night(dataDir);
      await night.start();
      try {
        const { roomCode } = await night.cmd("night.open", { quizId: quiz.id }) as { roomCode: string };
        for (const t of TEAMS) await night.join(roomCode, t);
        const id = (t: TeamName) => night.phone(t).teamId;
        await waitFor<DisplayView>(night.display, (v) => v.teams.length === 4, "4 teams on the display");
        const dup = await night.client("team", "second phone");
        expect(await code(dup, "team.join", { roomCode, name: "alpha" })).toBe("team_has_phone");

        await night.cmd("quiz.start");
        expect(await code(night.phone("Delta").c, "joker.play", { round: 2 })).toBe("joker_wrong_round");

        // --- play a round -------------------------------------------------------------
        const send = async (t: TeamName, r: number, i: number) => {
          const p = plan(quiz, r, i, t);
          if (!p) return;
          if (p.value.type === "text") watch.guess(id(t), p.value.text);
          const qq = quiz.rounds[r]!.questions[i]!;
          const ack = await night.phone(t).c.cmd("answer.submit", { questionId: qq.id, value: p.value });
          if (!ack.ok) throw new Error(`${t} r${r} q${i}: ${JSON.stringify(ack.error)}`);
          expect((ack.result as { receivedAt: number }).receivedAt).toBeGreaterThan(0);
        };
        const sendAll = async (r: number, i: number, only: readonly TeamName[] = TEAMS) => {
          await Promise.all(only.map((t) => send(t, r, i)));
        };
        /** Marks the pending text groups as the plan says. */
        const markPending = async (r: number) => {
          const mq = night.hostView().marking!.questions;
          for (const m of mq) {
            const i = quiz.rounds[r]!.questions.findIndex((x) => x.id === m.question.id);
            for (const g of m.groups.filter((x) => x.mark === "pending")) {
              const right = plan(quiz, r, i, TEAMS.find((t) => id(t) === g.teamIds[0])!)!.right;
              await ok(night.host, "mark.group", { questionId: m.question.id, key: g.key, mark: right ? "correct" : "wrong" });
            }
          }
          expect(night.hostView().marking!.pendingTotal).toBe(0);
        };

        let snapshot: { standings: unknown; history: HistoryDetail } | null = null;
        const historyNow = async () => (await (await night.p.fetch(`/api/history/${night.hostView().night!.id}`, { cookie: night.cookie })).json()) as HistoryDetail;
        /** Every answer, mark and score from before the kill is still there. */
        const sameAsBefore = async () => {
          const after = await historyNow();
          const key = (a: HistoryDetail["answers"][number]) => `${a.teamId}:${a.questionId}`;
          const sort = (xs: HistoryDetail["answers"]) => [...xs].sort((a, b) => key(a).localeCompare(key(b)));
          expect(sort(after.answers)).toEqual(sort(snapshot!.history.answers));
          expect(after.answers.length).toBeGreaterThan(20);
          expect(after.standings).toEqual(snapshot!.history.standings);
        };

        for (let r = 0; r < 4; r++) {
          expect(night.hostView().phase).toBe("round_intro");
          await night.cmd("round.start");
          const qs = quiz.rounds[r]!.questions;
          const restartHere = r === 2;

          if (lockMode === "question") {
            for (let i = 0; i < qs.length; i++) {
              await night.cmd("question.next");
              if (restartHere && i === 0) {
                // kill -9 with the timer running and three of four answers in
                await night.cmd("timer.start");
                await sendAll(r, i, ["Alpha", "Bravo", "Charlie"]);
                await waitFor<HostView>(night.host, (v) => v.current!.answered === 3, "3 answers");
                snapshot = { standings: night.hostView().standings, history: await historyNow() };
                const before = night.hostView().current!.timer.locksAt!;
                const { downMs } = await night.killAndRestart();
                const hv = night.hostView();
                expect(hv.phase).toBe("asking");
                expect(hv.current!.id).toBe(qs[0]!.id);
                expect(hv.current!.answered).toBe(3);
                expect(hv.current!.timer).toMatchObject({ state: "running", locksAt: before });
                expect(hv.standings).toEqual(snapshot.standings as never);
                expect(downMs).toBeLessThan(10_000);
                await sameAsBefore();
                for (const t of ["Alpha", "Bravo", "Charlie"] as const) {
                  expect(night.teamView(t).answers.map((a) => a.value)).toEqual([plan(quiz, r, 0, t)!.value]);
                }
                await sendAll(r, i, ["Delta"]);
                await night.cmd("lock");
              } else if (r === 0 && i === 2) {
                // this question has a 10 s timer: let it run out on real time
                await night.cmd("timer.start");
                await sendAll(r, i);
                await waitFor<HostView>(night.host, (v) => v.current!.status === "locked", "timer to run out", 15_000);
                expect(await code(night.phone("Alpha").c, "answer.submit", { questionId: qs[i]!.id, value: { type: "number", value: 1 } })).toBe("too_late");
              } else {
                await sendAll(r, i);
                if (r === 1 && i === 0) {   // change of answer: the last one counts
                  watch.guess(id("Delta"), "deltachanged");
                  await ok(night.phone("Delta").c, "answer.submit", { questionId: qs[i]!.id, value: { type: "text", text: "deltachanged" } });
                }
                await night.cmd("lock");
              }
            }
          } else {
            for (let i = 0; i < qs.length; i++) await night.cmd("question.next");
            expect(night.teamView("Alpha").questions.length).toBe(3);
            await night.cmd("timer.start");
            if (restartHere) {
              await sendAll(r, 0, ["Alpha", "Bravo", "Charlie"]);
              await sendAll(r, 1, ["Alpha", "Bravo"]);
              await sendAll(r, 2, ["Alpha", "Bravo"]);
              await waitFor<HostView>(night.host, (v) => v.round!.questions[1]!.answered === 2, "answers");
              snapshot = { standings: night.hostView().standings, history: await historyNow() };
              const before = night.hostView().round!.questions[0]!.timer.locksAt!;
              await night.killAndRestart();
              await sameAsBefore();
              const hv = night.hostView();
              expect(hv.phase).toBe("asking");
              expect(hv.round!.questions.map((x) => x.answered)).toEqual([3, 2, 2]);
              expect(hv.round!.questions.every((x) => x.status === "open" && x.timer.locksAt === before)).toBe(true);
              expect(hv.standings).toEqual(snapshot.standings as never);
              expect(night.teamView("Alpha").answers.length).toBe(3);
              expect(night.teamView("Charlie").answers.length).toBe(1);
              await sendAll(r, 0, ["Delta"]);
              await sendAll(r, 1, ["Charlie", "Delta"]);
              await sendAll(r, 2, ["Charlie", "Delta"]);
            } else {
              for (let i = 0; i < qs.length; i++) await sendAll(r, i);
              if (r === 1) {   // change of answer: the last one counts
                watch.guess(id("Delta"), "deltachanged");
                await ok(night.phone("Delta").c, "answer.submit", { questionId: qs[0]!.id, value: { type: "text", text: "deltachanged" } });
              }
            }
            await night.cmd("lock");
          }

          await night.cmd("round.finish");
          expect(night.hostView().phase).toBe("marking");
          expect(await code(night.host, "reveal.start")).toBe("marks_pending");
          await markPending(r);
          if (r === 3) {
            await night.cmd("leaderboard.show");   // skip the reveal (H-11)
          } else {
            await night.cmd("reveal.start");
            for (let i = 0; i < qs.length; i++) {
              const v = await waitFor<DisplayView>(night.display, (d) => d.phase === "reveal" && d.reveal?.question.id === qs[i]!.id, `reveal ${i}`);
              if (qs[i]!.answer.type === "text") expect(v.reveal!.answerText).toBe(`ans${r + 1}x1z`);
              await night.cmd("reveal.next");
            }
          }
          expect(night.hostView().phase).toBe("leaderboard");
          await waitFor<DisplayView>(night.display, (d) => d.standings?.round === r, `standings after round ${r + 1}`);

          if (r === 0) {
            // jokers: Charlie on round 2 (from the leaderboard), checked on the phone
            await ok(night.phone("Charlie").c, "joker.play", { round: 1 });
            expect(await code(night.phone("Charlie").c, "joker.play", { round: 2 })).toBe("joker_used");
            await waitFor<TeamView>(night.phone("Charlie").c, (v) => v.self!.jokerRound === 1, "joker on phone");
          }
          if (r === 1) {
            // dispute: Charlie's round-1 text answer is changed from wrong to right on the history API (open night)
            const before = night.hostView().standings!.rows.find((x) => x.teamId === id("Charlie"))!.total;
            await ok(night.host, "mark.team", { questionId: quiz.rounds[0]!.questions[0]!.id, teamId: id("Charlie"), mark: "correct" });
            await waitFor<HostView>(night.host, (v) => v.standings!.rows.find((x) => x.teamId === id("Charlie"))!.total === before + 1, "dispute applied");
            const h = await historyNow();
            expect(h.night.status).toBe("open");
            expect(h.answers).toContainEqual({ teamId: id("Charlie"), questionId: quiz.rounds[0]!.questions[0]!.id, display: "charliesguess", mark: "correct" });
            // halftime after round 2 (auto), then on to round 3
            await night.cmd("round.next");
            expect(night.hostView().phase).toBe("halftime");
            await waitFor<DisplayView>(night.display, (d) => d.phase === "halftime" && !!d.standings, "halftime standings");
            await night.cmd("round.next");
          } else if (r < 3) {
            await night.cmd("round.next");
          }
        }

        // --- the tie and sudden death --------------------------------------------------
        const hv = night.hostView();
        const totals = Object.fromEntries(hv.standings!.rows.map((x) => [x.name, x.total]));
        expect(totals).toEqual({ Alpha: 12, Bravo: 12, Charlie: 8, Delta: 0 });
        const top = hv.standings!.rows.filter((x) => x.position === 1);
        expect(top.map((x) => x.name).sort()).toEqual(["Alpha", "Bravo"]);
        expect(top.every((x) => x.shared && x.decidedBy === "shared")).toBe(true);
        expect(hv.suddenDeathNeeded!.position).toBe(1);
        expect([...hv.suddenDeathNeeded!.teamIds].sort()).toEqual([id("Alpha"), id("Bravo")].sort());

        await night.cmd("sd.start");
        const sd = quiz.suddenDeath;
        // question 1: both right, both stay in
        await night.cmd("sd.ask");
        expect(night.teamView("Alpha").self!.inSuddenDeath).toBe(true);
        expect(night.teamView("Charlie").self!.inSuddenDeath).toBe(false);
        expect(await code(night.phone("Charlie").c, "answer.submit", { questionId: sd[0]!.id, value: { type: "choice", index: 1 } })).not.toBe("ok");
        await ok(night.phone("Alpha").c, "answer.submit", { questionId: sd[0]!.id, value: { type: "choice", index: 1 } });
        await ok(night.phone("Bravo").c, "answer.submit", { questionId: sd[0]!.id, value: { type: "choice", index: 1 } });
        await night.cmd("lock");
        await night.cmd("sd.reveal");
        let dv = await waitFor<DisplayView>(night.display, (d) => d.suddenDeath?.status === "revealed", "sd reveal 1");
        expect(dv.suddenDeath!.outcome).toBeNull();
        expect(dv.suddenDeath!.teams.length).toBe(2);
        // question 2 (typed): Alpha right, Bravo wrong after marking
        await night.cmd("sd.ask");
        watch.guess(id("Alpha"), "sdans2z");
        watch.guess(id("Bravo"), "bravosdguess");
        await ok(night.phone("Alpha").c, "answer.submit", { questionId: sd[1]!.id, value: { type: "text", text: "sdans2z" } });
        await ok(night.phone("Bravo").c, "answer.submit", { questionId: sd[1]!.id, value: { type: "text", text: "bravosdguess" } });
        await night.cmd("lock");
        expect(await code(night.host, "sd.reveal")).toBe("marks_pending");
        const g = night.hostView().suddenDeath!.marking!.groups.find((x) => x.mark === "pending")!;
        await ok(night.host, "mark.group", { questionId: sd[1]!.id, key: g.key, mark: "wrong" });
        await night.cmd("sd.reveal");
        dv = await waitFor<DisplayView>(night.display, (d) => d.suddenDeath?.outcome !== null && d.suddenDeath?.outcome !== undefined, "sd outcome");
        expect(dv.suddenDeath!.outcome).toEqual({ position: 1, teamIds: [id("Alpha")], result: "won" });

        // --- Quiz End ------------------------------------------------------------------
        await night.cmd("quiz.end");
        dv = await waitFor<DisplayView>(night.display, (d) => d.phase === "ended" && !!d.final, "final");
        expect(dv.final!.winners.map((w) => w.name)).toEqual(["Alpha"]);
        expect(dv.final!.lastPlace.map((w) => w.name)).toEqual(["Delta"]);
        expect(dv.standings!.rows.map((x) => [x.name, x.position, x.decidedBy])).toEqual([
          ["Alpha", 1, "sudden_death"], ["Bravo", 2, "sudden_death"], ["Charlie", 3, "points"], ["Delta", 4, "points"],
        ]);
        await night.cmd("final.show");
        await waitFor<DisplayView>(night.display, (d) => d.final!.standingsAt !== null, "final standings");

        // --- history -------------------------------------------------------------------
        const list = await (await night.p.fetch("/api/history", { cookie: night.cookie })).json() as { nights: { id: string; winners: string[]; teams: number; endedAt: number | null }[] };
        expect(list.nights[0]).toMatchObject({ winners: ["Alpha"], teams: 4 });
        expect(list.nights[0]!.endedAt).not.toBeNull();
        const h = await historyNow();
        expect(h.night.status).toBe("ended");
        expect(h.standings.map((x) => [x.name, x.position, x.total])).toEqual([["Alpha", 1, 12], ["Bravo", 2, 12], ["Charlie", 3, 8], ["Delta", 4, 0]]);
        expect(h.rounds.map((x) => x.index)).toEqual([0, 1, 2, 3, -1]);
        expect(h.rounds[4]!.questions.map((x) => x.id)).toEqual([sd[0]!.id, sd[1]!.id]);
        // every planned answer is stored with the mark the plan says
        for (let r = 0; r < 4; r++) {
          quiz.rounds[r]!.questions.forEach((qq, i) => {
            for (const t of TEAMS) {
              const p = plan(quiz, r, i, t);
              const row = h.answers.find((a) => a.teamId === id(t) && a.questionId === qq.id);
              if (!p) { expect(row).toBeUndefined(); continue; }
              const disputed = t === "Charlie" && r === 0 && i === 0;
              expect({ t, q: qq.id, mark: row?.mark }).toEqual({ t, q: qq.id, mark: p.right || disputed ? "correct" : "wrong" });
            }
          });
        }
        expect(h.answers.find((a) => a.teamId === id("Delta") && a.questionId === quiz.rounds[1]!.questions[0]!.id)!.display).toBe("deltachanged");

        await night.cmd("night.close");
        expect(await night.phone("Alpha").c.next("bye")).toEqual({ t: "bye", reason: "night_closed" });
        await waitFor<DisplayView>(night.display, (d) => d.phase === "idle", "idle");

        // --- privacy: every display and team view in the run --------------------------
        const report = watch.check(night.all);
        console.log(`[e2e ${lockMode}] ${night.p.target}: privacy-checked ${report.checked.display} display and ${report.checked.team} team views`);
        expect(report.problems).toEqual([]);
        expect(report.checked.display).toBeGreaterThan(50);
        expect(report.checked.team).toBeGreaterThan(200);
      } catch (e) {
        console.error(night.p?.log().slice(-4000));
        throw e;
      } finally {
        await night.stop();
      }
    }, 90_000);
  });
}
