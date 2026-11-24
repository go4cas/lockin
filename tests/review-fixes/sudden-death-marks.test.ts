// Sudden-death marks stay consistent with revealed outcomes (code review LI-005).
import { afterEach, describe, expect, test } from "bun:test";
import { displayView } from "../../src/server/night/views.ts";
import { choice, code, host, joinTeam, makeQuiz, q, rig, writeQuiz, type Rig } from "../night/fakes.ts";

const rigs: Rig[] = [];
afterEach(() => { while (rigs.length) rigs.pop()!.close(); });

describe("revealed sudden-death questions are final (LI-005)", () => {
  test("after the next question opens, an earlier revealed question cannot be re-marked by team or group, before or after a restart", () => {
    const r = rig();
    rigs.push(r);
    const sd = Array.from({ length: 3 }, () => q(choice(1)));
    const quiz = makeQuiz("friday", [[q(choice(0))]], {}, sd);
    writeQuiz(r.dataDir, quiz);
    host(r, "night.open", { quizId: "friday" });
    const [a, b, c] = ["Alpha", "Bravo", "Charlie"].map((n) => joinTeam(r, n));
    host(r, "quiz.start");
    host(r, "round.start");
    host(r, "question.next");
    host(r, "lock");                    // nobody answers: a three-way tie for first
    host(r, "round.finish");
    host(r, "leaderboard.show");
    host(r, "sd.start");
    host(r, "sd.ask");
    for (const t of [a!, b!]) r.engine.command(t, "answer.submit", { questionId: sd[0]!.id, value: { type: "choice", index: 1 } });
    r.engine.command(c!, "answer.submit", { questionId: sd[0]!.id, value: { type: "choice", index: 0 } });
    host(r, "lock");
    host(r, "sd.reveal");               // Charlie is out; Alpha and Bravo go on
    expect(displayView(r.engine).suddenDeath!.rightIds!.sort()).toEqual([a!.teamId, b!.teamId].sort());
    host(r, "sd.ask");                  // question 2 is now current

    const tryEdits = (rr: Rig) => {
      expect(code(rr.engine.command(rr.host, "mark.team", { questionId: sd[0]!.id, teamId: b!.teamId, mark: "wrong" }))).toBe("wrong_phase");
      expect(code(rr.engine.command(rr.host, "mark.team", { questionId: sd[0]!.id, teamId: c!.teamId, mark: "correct" }))).toBe("wrong_phase");
      expect(code(rr.engine.command(rr.host, "mark.group", { questionId: sd[0]!.id, key: "choice:1", mark: "wrong" }))).toBe("wrong_phase");
      const row = rr.engine.m!.sd.find((x) => x.questionId === sd[0]!.id)!;
      const correct = row.teamIds.filter((t) => rr.engine.answer(t, sd[0]!.id)?.mark === "correct");
      expect(correct.sort()).toEqual([...row.rightIds!].sort());
    };
    tryEdits(r);
    const r2 = r.restart();
    rigs.push(r2);
    tryEdits(r2);
  });
});
