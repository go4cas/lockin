// B2: scoring, positions, tie breaker, sudden death and leaderboard lines
// (TECH-SPEC 8.3 to 8.5 and 5.5).
import { describe, expect, test } from "bun:test";
import type { ScoreResult, StandingRow, SuddenDeathOutcome } from "../../src/shared/rules-api.ts";
import { rules } from "../../src/server/rules/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rounds of `n` questions each, ids r<round>q<question>. */
function rounds(...sizes: number[]) {
  return sizes.map((n, r) => ({ questionIds: Array.from({ length: n }, (_, q) => `r${r}q${q}`) }));
}
/** Marks the first `n` questions of round `r` correct for a team. */
function right(team: string, r: number, n: number): string[] {
  return Array.from({ length: n }, (_, q) => `${team}:r${r}q${q}`);
}
/** A score result straight from totals and round wins, for ranking tests. */
function result(teams: [id: string, total: number, roundWins: number][]): ScoreResult {
  return { teams: teams.map(([id, total, roundWins]) => ({ id, total, roundWins, roundScores: [total] })) };
}
const view = (rows: StandingRow[]) => rows.map((r) => [r.teamId, r.position, r.shared, r.decidedBy]);

/**
 * Plays sudden death for one position the way the engine (B1) would, using
 * resolveSuddenDeath, and returns the outcome that rank() reads:
 * groups best first. Teams that drop out later rank above teams that dropped
 * out earlier. Stops when one team is left (a winner) or after `max` questions.
 */
function playSuddenDeath(position: number, teamIds: string[], rightPerQuestion: string[][], max: number): SuddenDeathOutcome {
  let inIt = [...teamIds];
  const dropped: string[][] = [];
  for (let q = 0; q < Math.min(max, rightPerQuestion.length); q++) {
    const { winner, remaining } = rules.resolveSuddenDeath(inIt, rightPerQuestion[q]!);
    if (winner) {
      return { position, order: [[winner], ...(remaining.length ? [remaining] : []), ...dropped.reverse()] };
    }
    const out = inIt.filter((id) => !remaining.includes(id));
    if (out.length) dropped.push(out);
    inIt = remaining;
    if (inIt.length === 1) return { position, order: [inIt, ...dropped.reverse()] };
  }
  return { position, order: [inIt, ...dropped.reverse()] };
}

// ---------------------------------------------------------------------------
// 8.3 Scoring
// ---------------------------------------------------------------------------

describe("score (8.3)", () => {
  test("1 point per correct answer per round; total is the sum; order kept", () => {
    const s = rules.score({
      rounds: rounds(3, 3),
      teams: [{ id: "a", jokerRound: null }, { id: "b", jokerRound: null }],
      correct: new Set([...right("a", 0, 2), ...right("a", 1, 3), ...right("b", 0, 1)]),
    });
    expect(s.teams.map((t) => [t.id, t.roundScores, t.total])).toEqual([["a", [2, 3], 5], ["b", [1, 0], 1]]);
  });

  test("ignores correct keys for other teams or questions not in the quiz", () => {
    const s = rules.score({ rounds: rounds(2), teams: [{ id: "a", jokerRound: null }], correct: new Set(["a:sd1", "b:r0q0", "a:r0q0"]) });
    expect(s.teams[0]!.total).toBe(1);
  });

  test("joker doubles that round only (0-based round index)", () => {
    const s = rules.score({
      rounds: rounds(3, 3, 3),
      teams: [{ id: "a", jokerRound: 1 }, { id: "b", jokerRound: null }],
      correct: new Set([...right("a", 0, 1), ...right("a", 1, 2), ...right("a", 2, 3), ...right("b", 1, 2)]),
    });
    expect(s.teams[0]!.roundScores).toEqual([1, 4, 3]);
    expect(s.teams[0]!.total).toBe(8);
    expect(s.teams[1]!.roundScores).toEqual([0, 2, 0]);
  });

  test("joker on the last round, and a joker round with 0 correct stays 0", () => {
    const s = rules.score({
      rounds: rounds(2, 2),
      teams: [{ id: "a", jokerRound: 1 }, { id: "b", jokerRound: 0 }],
      correct: new Set([...right("a", 1, 2), ...right("b", 1, 1)]),
    });
    expect(s.teams.map((t) => t.roundScores)).toEqual([[0, 4], [0, 1]]);
  });

  test("shared round win: every team on the top score gets a win", () => {
    const s = rules.score({
      rounds: rounds(3),
      teams: [{ id: "a", jokerRound: null }, { id: "b", jokerRound: null }, { id: "c", jokerRound: null }],
      correct: new Set([...right("a", 0, 2), ...right("b", 0, 2), ...right("c", 0, 1)]),
    });
    expect(s.teams.map((t) => t.roundWins)).toEqual([1, 1, 0]);
  });

  test("joker round win: the joker counts toward the round win", () => {
    const s = rules.score({
      rounds: rounds(5),
      teams: [{ id: "a", jokerRound: 0 }, { id: "b", jokerRound: null }],
      correct: new Set([...right("a", 0, 3), ...right("b", 0, 5)]),
    });
    // a: 3 x 2 = 6 beats b: 5.
    expect(s.teams.map((t) => [t.roundScores[0], t.roundWins])).toEqual([[6, 1], [5, 0]]);
  });

  test("joker can make a shared round win", () => {
    const s = rules.score({
      rounds: rounds(4),
      teams: [{ id: "a", jokerRound: 0 }, { id: "b", jokerRound: null }],
      correct: new Set([...right("a", 0, 2), ...right("b", 0, 4)]),
    });
    expect(s.teams.map((t) => t.roundWins)).toEqual([1, 1]);
  });

  test("a round where everyone scores 0 has no winner", () => {
    const s = rules.score({
      rounds: rounds(2, 2),
      teams: [{ id: "a", jokerRound: null }, { id: "b", jokerRound: null }],
      correct: new Set(right("a", 1, 1)),
    });
    // Round 0: both on 0, no winner. Round 1: a wins. So a has 1 win, not 2.
    expect(s.teams.map((t) => t.roundWins)).toEqual([1, 0]);
  });

  test("round wins add up over rounds", () => {
    const s = rules.score({
      rounds: rounds(2, 2, 2),
      teams: [{ id: "a", jokerRound: null }, { id: "b", jokerRound: null }],
      correct: new Set([...right("a", 0, 2), ...right("a", 1, 1), ...right("b", 1, 1), ...right("b", 2, 1)]),
    });
    expect(s.teams.map((t) => t.roundWins)).toEqual([2, 2]);
  });

  test("no teams and no rounds", () => {
    expect(rules.score({ rounds: [], teams: [], correct: new Set() })).toEqual({ teams: [] });
    expect(rules.score({ rounds: [], teams: [{ id: "a", jokerRound: null }], correct: new Set() }).teams[0])
      .toEqual({ id: "a", roundScores: [], total: 0, roundWins: 0 });
  });
});

// ---------------------------------------------------------------------------
// 8.4 Positions and the tie breaker
// ---------------------------------------------------------------------------

describe("rank (8.4)", () => {
  test("distinct totals: ranked by points", () => {
    const rows = rules.rank(result([["a", 5, 0], ["b", 9, 0], ["c", 7, 0]]), []);
    expect(view(rows)).toEqual([["b", 1, false, "points"], ["c", 2, false, "points"], ["a", 3, false, "points"]]);
  });

  test("rows carry total, round scores and round wins", () => {
    const rows = rules.rank({ teams: [{ id: "a", roundScores: [2, 4], total: 6, roundWins: 1 }] }, []);
    expect(rows[0]).toEqual({ teamId: "a", position: 1, shared: false, total: 6, roundScores: [2, 4], roundWins: 1, decidedBy: "points" });
  });

  test("tie breaker: teams level on points rank by round wins", () => {
    const rows = rules.rank(result([["a", 10, 1], ["b", 10, 3], ["c", 12, 0]]), []);
    expect(view(rows)).toEqual([["c", 1, false, "points"], ["b", 2, false, "tie_breaker"], ["a", 3, false, "tie_breaker"]]);
  });

  test("three-way tie by points, settled by the tie breaker", () => {
    const rows = rules.rank(result([["a", 10, 1], ["b", 10, 2], ["c", 10, 0], ["d", 4, 0]]), []);
    expect(view(rows)).toEqual([
      ["b", 1, false, "tie_breaker"], ["a", 2, false, "tie_breaker"], ["c", 3, false, "tie_breaker"], ["d", 4, false, "points"],
    ]);
  });

  test("three-way tie by points and round wins: shared 1st, next team is 4th (competition ranking)", () => {
    const rows = rules.rank(result([["a", 10, 1], ["b", 10, 1], ["c", 10, 1], ["d", 4, 0]]), []);
    expect(view(rows)).toEqual([
      ["a", 1, true, "shared"], ["b", 1, true, "shared"], ["c", 1, true, "shared"], ["d", 4, false, "points"],
    ]);
  });

  test("tie breaker splits some: one placed, two still share the next position", () => {
    const rows = rules.rank(result([["a", 8, 1], ["b", 8, 2], ["c", 8, 1], ["d", 9, 0], ["e", 1, 0]]), []);
    expect(view(rows)).toEqual([
      ["d", 1, false, "points"], ["b", 2, false, "tie_breaker"], ["a", 3, true, "shared"], ["c", 3, true, "shared"], ["e", 5, false, "points"],
    ]);
  });

  test("two separate shared positions", () => {
    const rows = rules.rank(result([["a", 5, 1], ["b", 5, 1], ["c", 3, 0], ["d", 3, 0]]), []);
    expect(rows.map((r) => [r.teamId, r.position])).toEqual([["a", 1], ["b", 1], ["c", 3], ["d", 3]]);
  });

  test("everyone on 0", () => {
    const rows = rules.rank(result([["a", 0, 0], ["b", 0, 0]]), []);
    expect(view(rows)).toEqual([["a", 1, true, "shared"], ["b", 1, true, "shared"]]);
  });

  test("end to end: score then rank, a joker round win breaks a points tie", () => {
    const s = rules.score({
      rounds: rounds(4, 4),
      teams: [{ id: "a", jokerRound: 0 }, { id: "b", jokerRound: null }],
      // a: 2x2=4 + 1 = 5, wins round 0. b: 3 + 2 = 5, wins round 1.  Level on 1 win each.
      correct: new Set([...right("a", 0, 2), ...right("a", 1, 1), ...right("b", 0, 3), ...right("b", 1, 2)]),
    });
    expect(s.teams.map((t) => [t.total, t.roundWins])).toEqual([[5, 1], [5, 1]]);
    expect(view(rules.rank(s, []))).toEqual([["a", 1, true, "shared"], ["b", 1, true, "shared"]]);
  });
});

// ---------------------------------------------------------------------------
// 8.5 Sudden death
// ---------------------------------------------------------------------------

describe("resolveSuddenDeath (8.5)", () => {
  test.each([
    ["two teams, one right", ["a", "b"], ["b"], { winner: "b", remaining: ["a"] }],
    ["two teams, both right", ["a", "b"], ["a", "b"], { winner: null, remaining: ["a", "b"] }],
    ["two teams, none right", ["a", "b"], [], { winner: null, remaining: ["a", "b"] }],
    ["three teams, one right", ["a", "b", "c"], ["c"], { winner: "c", remaining: ["a", "b"] }],
    ["three teams, two right: wrong one drops out", ["a", "b", "c"], ["a", "c"], { winner: null, remaining: ["a", "c"] }],
    ["three teams, all right", ["a", "b", "c"], ["c", "b", "a"], { winner: null, remaining: ["a", "b", "c"] }],
    ["three teams, none right", ["a", "b", "c"], [], { winner: null, remaining: ["a", "b", "c"] }],
    ["right ids outside the tie are ignored", ["a", "b"], ["a", "z"], { winner: "a", remaining: ["b"] }],
  ] as [string, string[], string[], { winner: string | null; remaining: string[] }][])("%s", (_n, ids, rightIds, expected) => {
    expect(rules.resolveSuddenDeath(ids, rightIds)).toEqual(expected);
  });
});

describe("sudden death through rank (8.4, 8.5)", () => {
  const TIED2 = result([["a", 10, 1], ["b", 10, 1], ["c", 5, 0]]);
  const TIED3 = result([["a", 10, 1], ["b", 10, 1], ["c", 10, 1], ["d", 5, 0]]);

  test("two teams, one right on the first question", () => {
    const o = playSuddenDeath(1, ["a", "b"], [["b"]], 3);
    expect(o).toEqual({ position: 1, order: [["b"], ["a"]] });
    expect(view(rules.rank(TIED2, [o]))).toEqual([["b", 1, false, "sudden_death"], ["a", 2, false, "sudden_death"], ["c", 3, false, "points"]]);
  });

  test("two teams, both right then none right then one right", () => {
    const o = playSuddenDeath(1, ["a", "b"], [["a", "b"], [], ["a"]], 3);
    expect(view(rules.rank(TIED2, [o]))).toEqual([["a", 1, false, "sudden_death"], ["b", 2, false, "sudden_death"], ["c", 3, false, "points"]]);
  });

  test("two teams, none right until the maximum: they share the position", () => {
    const o = playSuddenDeath(1, ["a", "b"], [[], ["a", "b"], [], ["a"]], 3);
    expect(o).toEqual({ position: 1, order: [["a", "b"]] });
    const rows = rules.rank(TIED2, [o]);
    expect(view(rows)).toEqual([["a", 1, true, "shared"], ["b", 1, true, "shared"], ["c", 3, false, "points"]]);
    expect(rules.suddenDeathNeeded(rows, "first", [o])).toBeNull();
  });

  test("three teams, one right: it takes 1st, the other two share 2nd", () => {
    const o = playSuddenDeath(1, ["a", "b", "c"], [["c"]], 3);
    const rows = rules.rank(TIED3, [o]);
    expect(view(rows)).toEqual([
      ["c", 1, false, "sudden_death"], ["a", 2, true, "shared"], ["b", 2, true, "shared"], ["d", 4, false, "points"],
    ]);
    // Scope "first": done. Scope "all": 2nd place is next.
    expect(rules.suddenDeathNeeded(rows, "first", [o])).toBeNull();
    expect(rules.suddenDeathNeeded(rows, "all", [o])).toEqual({ position: 2, teamIds: ["a", "b"] });
    const o2 = playSuddenDeath(2, ["a", "b"], [["b"]], 3);
    expect(view(rules.rank(TIED3, [o, o2]))).toEqual([
      ["c", 1, false, "sudden_death"], ["b", 2, false, "sudden_death"], ["a", 3, false, "sudden_death"], ["d", 4, false, "points"],
    ]);
    expect(rules.suddenDeathNeeded(rules.rank(TIED3, [o, o2]), "all", [o, o2])).toBeNull();
  });

  test("three teams, two right: the wrong one drops to 3rd, then one right wins", () => {
    const o = playSuddenDeath(1, ["a", "b", "c"], [["a", "b"], ["b"]], 3);
    expect(o).toEqual({ position: 1, order: [["b"], ["a"], ["c"]] });
    expect(view(rules.rank(TIED3, [o]))).toEqual([
      ["b", 1, false, "sudden_death"], ["a", 2, false, "sudden_death"], ["c", 3, false, "sudden_death"], ["d", 4, false, "points"],
    ]);
  });

  test("three teams, two right, then the maximum is reached: two share 1st, one is 3rd", () => {
    const o = playSuddenDeath(1, ["a", "b", "c"], [["a", "c"], [], ["a", "c"]], 3);
    expect(o).toEqual({ position: 1, order: [["a", "c"], ["b"]] });
    const rows = rules.rank(TIED3, [o]);
    expect(view(rows)).toEqual([
      ["a", 1, true, "shared"], ["c", 1, true, "shared"], ["b", 3, false, "sudden_death"], ["d", 4, false, "points"],
    ]);
    expect(rules.suddenDeathNeeded(rows, "all", [o])).toBeNull();
  });

  test("three teams, none right until the maximum: all three share", () => {
    const o = playSuddenDeath(1, ["a", "b", "c"], [[], [], []], 3);
    const rows = rules.rank(TIED3, [o]);
    expect(rows.filter((r) => r.position === 1 && r.shared)).toHaveLength(3);
    expect(rules.suddenDeathNeeded(rows, "first", [o])).toBeNull();
  });

  test("the sudden-death list running out ends it the same way as the maximum", () => {
    const o = playSuddenDeath(1, ["a", "b"], [[]], 3);
    expect(o).toEqual({ position: 1, order: [["a", "b"]] });
  });

  test("an outcome for teams that are no longer level there is ignored (mark changed after sudden death)", () => {
    const o = playSuddenDeath(1, ["a", "b"], [["b"]], 3);
    const changed = result([["a", 10, 1], ["c", 10, 1], ["b", 9, 0]]);
    const rows = rules.rank(changed, [o]);
    expect(view(rows)).toEqual([["a", 1, true, "shared"], ["c", 1, true, "shared"], ["b", 3, false, "points"]]);
    expect(rules.suddenDeathNeeded(rows, "first", [o])).toEqual({ position: 1, teamIds: ["a", "c"] });
  });
});

describe("suddenDeathNeeded (8.5)", () => {
  test("nothing shared: null", () => {
    expect(rules.suddenDeathNeeded(rules.rank(result([["a", 2, 0], ["b", 1, 0]]), []), "all", [])).toBeNull();
  });
  test("a tie settled by the tie breaker needs no sudden death", () => {
    expect(rules.suddenDeathNeeded(rules.rank(result([["a", 2, 1], ["b", 2, 0]]), []), "all", [])).toBeNull();
  });
  test("shared 1st, scope first", () => {
    const rows = rules.rank(result([["a", 2, 0], ["b", 2, 0], ["c", 1, 0]]), []);
    expect(rules.suddenDeathNeeded(rows, "first", [])).toEqual({ position: 1, teamIds: ["a", "b"] });
  });
  test("shared 2nd only: scope first says null, scope all says 2", () => {
    const rows = rules.rank(result([["a", 3, 0], ["b", 2, 0], ["c", 2, 0]]), []);
    expect(rules.suddenDeathNeeded(rows, "first", [])).toBeNull();
    expect(rules.suddenDeathNeeded(rows, "all", [])).toEqual({ position: 2, teamIds: ["b", "c"] });
  });
  test("scope all picks the best (lowest) shared position first", () => {
    const rows = rules.rank(result([["a", 3, 0], ["b", 3, 0], ["c", 1, 0], ["d", 1, 0]]), []);
    expect(rules.suddenDeathNeeded(rows, "all", [])).toEqual({ position: 1, teamIds: ["a", "b"] });
    const o = playSuddenDeath(1, ["a", "b"], [["a"]], 3);
    const after = rules.rank(result([["a", 3, 0], ["b", 3, 0], ["c", 1, 0], ["d", 1, 0]]), [o]);
    expect(rules.suddenDeathNeeded(after, "all", [o])).toEqual({ position: 3, teamIds: ["c", "d"] });
  });
});

// ---------------------------------------------------------------------------
// 5.5 Leaderboard line
// ---------------------------------------------------------------------------

describe("leaderboardLine (5.5)", () => {
  const r = (teams: [string, number, number][], sd: SuddenDeathOutcome[] = []) => rules.rank(result(teams), sd);

  test("first leaderboard, clear lead: no line", () => {
    expect(rules.leaderboardLine(null, r([["a", 9, 1], ["b", 5, 0]]))).toBeNull();
  });
  test("first leaderboard, close race", () => {
    expect(rules.leaderboardLine(null, r([["a", 6, 1], ["b", 5, 0]]))).toBe("close_race");
  });
  test("tie breaker decided 1st place", () => {
    expect(rules.leaderboardLine(null, r([["a", 6, 2], ["b", 6, 1]]))).toBe("tie_breaker");
  });
  test("tie breaker beats lead change and close race (priority)", () => {
    const before = r([["b", 6, 1], ["a", 3, 0]]);
    expect(rules.leaderboardLine(before, r([["a", 8, 2], ["b", 8, 1]]))).toBe("tie_breaker");
  });
  test("tie breaker deciding a lower place only is not a tie_breaker line", () => {
    expect(rules.leaderboardLine(null, r([["a", 20, 3], ["b", 6, 2], ["c", 6, 1]]))).toBeNull();
  });
  test("lead change", () => {
    const before = r([["a", 9, 1], ["b", 5, 0]]);
    expect(rules.leaderboardLine(before, r([["b", 15, 1], ["a", 10, 1]]))).toBe("lead_change");
  });
  test("lead change beats close race", () => {
    const before = r([["a", 9, 1], ["b", 5, 0]]);
    expect(rules.leaderboardLine(before, r([["b", 11, 1], ["a", 10, 1]]))).toBe("lead_change");
  });
  test("a team joining a shared lead counts as a lead change", () => {
    const before = r([["a", 9, 1], ["b", 5, 0]]);
    expect(rules.leaderboardLine(before, r([["a", 12, 1], ["b", 12, 1]]))).toBe("lead_change");
  });
  test("a shared leader pulling clear is not a lead change", () => {
    const before = r([["a", 9, 1], ["b", 9, 1], ["c", 1, 0]]);
    expect(rules.leaderboardLine(before, r([["a", 15, 2], ["b", 10, 1], ["c", 2, 0]]))).toBeNull();
  });
  test("same leader, top two within 1 point: close race", () => {
    const before = r([["a", 9, 1], ["b", 5, 0]]);
    expect(rules.leaderboardLine(before, r([["a", 12, 1], ["b", 11, 1]]))).toBe("close_race");
  });
  test("top two level but still shared: close race", () => {
    const before = r([["a", 10, 1], ["b", 10, 1]]);
    expect(rules.leaderboardLine(before, r([["a", 12, 1], ["b", 12, 1]]))).toBe("close_race");
  });
  test("everyone on 0 is not a close race", () => {
    expect(rules.leaderboardLine(null, r([["a", 0, 0], ["b", 0, 0]]))).toBeNull();
  });
  test("one team only: no close race", () => {
    expect(rules.leaderboardLine(null, r([["a", 3, 1]]))).toBeNull();
  });
  test("big climb: a team rose 3 places", () => {
    const before = r([["a", 20, 1], ["b", 15, 0], ["c", 10, 0], ["d", 5, 0], ["e", 1, 0]]);
    // e goes from 5th to 2nd.
    const after = r([["a", 30, 1], ["e", 25, 1], ["b", 20, 0], ["c", 15, 0], ["d", 6, 0]]);
    expect(rules.leaderboardLine(before, after)).toBe("big_climb");
  });
  test("rising 2 places is not a big climb", () => {
    const before = r([["a", 20, 1], ["b", 15, 0], ["c", 10, 0], ["d", 5, 0]]);
    const after = r([["a", 30, 1], ["c", 25, 1], ["b", 20, 0], ["d", 15, 0]]);
    expect(rules.leaderboardLine(before, after)).toBeNull();
  });
  test("close race beats big climb (priority)", () => {
    const before = r([["a", 20, 1], ["b", 15, 0], ["c", 10, 0], ["d", 5, 0]]);
    const after = r([["a", 30, 1], ["d", 29, 1], ["b", 20, 0], ["c", 15, 0]]);
    expect(rules.leaderboardLine(before, after)).toBe("close_race");
  });
  test("a team not on the previous leaderboard is not a climb", () => {
    const before = r([["a", 20, 1], ["b", 15, 0]]);
    const after = r([["a", 30, 1], ["b", 20, 0], ["c", 1, 0], ["d", 0, 0], ["e", 0, 0]]);
    expect(rules.leaderboardLine(before, after)).toBeNull();
  });
  test("1st decided by sudden death is not a tie_breaker line", () => {
    const o: SuddenDeathOutcome = { position: 1, order: [["a"], ["b"]] };
    expect(rules.leaderboardLine(null, r([["a", 6, 1], ["b", 6, 1], ["c", 1, 0]], [o]))).toBe("close_race");
  });
});
