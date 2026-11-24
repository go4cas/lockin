// Code review LI-016: a command-to-phase matrix. At each step of a whole night (both lock modes,
// a halftime, sudden death and Quiz End) it records which host commands HostView.can allows and
// what each phone command answers, and compares the lot with the table below. The table was
// produced by the engine before it was split into modules, so the split provably moved no guard.
// REVIEW finding 12 (can.lock after a revealed sudden-death question) is the one known oddity;
// the test names it where it shows.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_COMMANDS } from "../../src/server/night/engine.ts";
import { TEAM_COMMANDS } from "../../src/shared/protocol.ts";
import { choice, host, joinTeam, makeQuiz, q, rig, writeQuiz, type Rig } from "./fakes.ts";

const rigs: Rig[] = [];
afterEach(() => { while (rigs.length) rigs.pop()!.close(); });

type Row = { step: string; phase: string; can: string[]; team: Record<string, string> };

function snapshot(r: Rig, step: string): Row {
  const e = r.engine;
  const can = e.can();
  return {
    step,
    phase: e.m ? e.state.phase : "idle",
    can: HOST_COMMANDS.filter((n) => can[n]),
    team: Object.fromEntries(TEAM_COMMANDS.map((n) => [n, e.blocked(n) ?? "ok"])),
  };
}

/** A whole night; `lockMode` picks per-question or per-round locking. */
function walk(lockMode: "question" | "round"): Row[] {
  const r = rig();
  rigs.push(r);
  const sd = [q(choice(1)), q(choice(1))];
  writeQuiz(r.dataDir, makeQuiz("matrix", [[q(choice(0)), q(choice(0))], [q(choice(0))], [q(choice(0))]],
    { lockMode, joker: true, halftimeAfterRound: 1 }, sd));
  const rows: Row[] = [];
  const at = (step: string) => rows.push(snapshot(r, step));
  at("idle");
  host(r, "night.open", { quizId: "matrix" });
  at("lobby, no teams");
  const [a, b] = ["Alpha", "Bravo"].map((n) => joinTeam(r, n));
  at("lobby, two teams");
  host(r, "quiz.start");
  at("round 1 intro");
  host(r, "round.start");
  at("round 1, nothing shown");
  host(r, "question.next");
  at("round 1, question 1 open");
  if (lockMode === "question") {
    host(r, "timer.start");
    at("round 1, question 1 timer running");
    host(r, "timer.pause");
    at("round 1, question 1 timer paused");
    host(r, "lock");
    at("round 1, question 1 locked");
    host(r, "question.next");
    at("round 1, question 2 open");
    host(r, "lock");
  } else {
    host(r, "question.next");
    at("round 1, both shown and open");
    host(r, "timer.start");
    at("round 1, round timer running");
    host(r, "lock");
  }
  at("round 1, all locked");
  host(r, "round.finish");
  at("round 1 marking");
  host(r, "reveal.start");
  at("round 1 reveal");
  host(r, "leaderboard.show");
  at("round 1 leaderboard (halftime round)");
  host(r, "round.next");
  at("halftime");
  host(r, "round.next");
  at("round 2 intro");
  for (const round of [2, 3]) {
    if (round === 3) { host(r, "round.next"); at("round 3 intro"); }
    host(r, "round.start");
    host(r, "question.next");
    host(r, "lock");
    host(r, "round.finish");
    host(r, "leaderboard.show");
    at(`round ${round} leaderboard`);
  }
  host(r, "sd.start");
  at("sudden death, between questions");
  host(r, "sd.ask");
  at("sudden death, question open");
  r.engine.command(a!, "answer.submit", { questionId: sd[0]!.id, value: { type: "choice", index: 1 } });
  r.engine.command(b!, "answer.submit", { questionId: sd[0]!.id, value: { type: "choice", index: 0 } });
  host(r, "lock");
  at("sudden death, question locked");
  host(r, "sd.reveal");
  at("sudden death, revealed and decided");
  host(r, "quiz.end");
  at("ended, winner showing");
  host(r, "final.show");
  at("ended, final standings");
  host(r, "night.close");
  at("closed");
  return rows;
}

describe("command-to-phase matrix (LI-016)", () => {
  for (const mode of ["question", "round"] as const) {
    test(`lock per ${mode}`, () => {
      const rows = walk(mode);
      const file = join(import.meta.dir, "fixtures", `command-matrix-${mode}.json`);
      // LOCKIN_WRITE_MATRIX=1 rewrites the table; only do that for a deliberate guard change.
      if (process.env.LOCKIN_WRITE_MATRIX) writeFileSync(file, JSON.stringify(rows, null, 2) + "\n");
      expect(rows).toEqual(JSON.parse(readFileSync(file, "utf8")) as Row[]);
    });
  }
});
