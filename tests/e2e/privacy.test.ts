// The privacy checker used by the B9 runs must catch leaks, not just pass: feed it
// the view fixtures (clean) and views with each kind of leak put in by hand.

import { describe, expect, test } from "bun:test";
import type { DisplayView, ServerMsg, TeamView } from "../../src/shared/protocol.ts";
import { PrivacyWatch } from "../helpers/privacy.ts";

const fixture = async <T>(path: string): Promise<T> => {
  const mod = await import(`../fixtures/views/${path}.ts`);
  return (mod.default ?? Object.values(mod)[0]) as T;
};
const state = (view: unknown, seq = 1): ServerMsg => ({ t: "state", seq, serverNow: 0, view } as ServerMsg);

describe("PrivacyWatch", () => {
  test("the display and team fixtures are clean", async () => {
    const w = new PrivacyWatch();
    for (const p of ["display/asking", "display/reveal", "display/leaderboard", "display/sudden_death", "display/ended"]) {
      expect(w.check([{ role: "display", received: [state(await fixture(p))] }]).problems).toEqual([]);
    }
    for (const p of ["team/asking", "team/leaderboard"]) {
      const v = await fixture<TeamView>(p);
      for (const a of v.answers) if (a.value.type === "text") w.guess(v.self!.id, a.value.text);
      expect(w.check([{ role: "team", received: [state(v)] }]).problems).toEqual([]);
    }
  });

  test("catches host-only data, early answers, other teams' answers and stray flashes", async () => {
    const asking = await fixture<DisplayView>("display/asking");
    const qid = asking.question!.id;
    const w = new PrivacyWatch();
    w.secret("the right answer", qid);
    w.guess("t-other", "someone else's guess");

    const leaks: [string, unknown, "display" | "team"][] = [
      ["host-only key", { ...asking, question: { ...asking.question!, answer: { type: "text", accepted: ["x"] } } }, "display"],
      ["answer text early", { ...asking, lines: { ...asking.lines, question: "It was The Right Answer" } }, "display"],
      ["another team's answer", { ...asking, lines: { ...asking.lines, question: "someone else's guess" } }, "display"],
      ["standings while asking", { ...asking, standings: { round: 0, rows: [] } }, "display"],
      ["no_answer flash on the display", { ...asking, flash: { id: 1, key: "no_answer", line: "x", teamId: "t-1", at: 0 } }, "display"],
      ["answers on the display", { ...asking, answers: [] }, "display"],
    ];
    for (const [what, view, role] of leaks) {
      expect({ what, caught: w.check([{ role, received: [state(view)] }]).problems.length > 0 }).toEqual({ what, caught: true });
    }

    const team = await fixture<TeamView>("team/asking");
    const mine = team.answers[0];
    const wrongTeam = { ...team, answers: mine ? [{ ...mine, value: { type: "text", text: "someone else's guess" } }] : [] };
    if (mine) expect(w.check([{ role: "team", received: [state(wrongTeam)] }]).problems.length).toBeGreaterThan(0);
    // SA-07: an unbound phone sees no teams, standings, flashes, night details or lines but lobby
    const unbound = { ...team, self: null, answers: [], questions: [] };
    expect(w.check([{ role: "team", received: [state({ ...unbound, teams: [{ id: "t-x", name: "X", colour: 1, jokerThisRound: false }] })] }]).problems.length).toBeGreaterThan(0);
    expect(w.check([{ role: "team", received: [state({ ...unbound, teams: [], night: { ...team.night!, quizTitle: "Friday" } })] }]).problems.length).toBeGreaterThan(0);
    const otherCode = { ...team, teams: [{ id: "t-x", name: "X", colour: 1, jokerThisRound: false, rejoinCode: "ABCDEF" }] };
    expect(w.check([{ role: "team", received: [state(otherCode)] }]).problems.length).toBeGreaterThan(0);
  });

  test("the revealed question's answer is allowed on the reveal screen only", async () => {
    const reveal = await fixture<DisplayView>("display/reveal");
    const w = new PrivacyWatch();
    w.secret(reveal.reveal!.answerText, reveal.reveal!.question.id);
    expect(w.check([{ role: "display", received: [state(reveal)] }]).problems).toEqual([]);
    const later = { ...reveal, phase: "leaderboard", reveal: null, lines: { ...reveal.lines, leaderboard: reveal.reveal!.answerText } };
    expect(w.check([{ role: "display", received: [state(later)] }]).problems.length).toBeGreaterThan(0);
  });
});
