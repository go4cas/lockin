import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

// Per-round mode: every question so far is open; two answered, the round timer runs.
const q = [1, 2, 3, 4, 5].map((n) => question(n, { timer: timer.running(300, 185), answered: 3 }));
export default {
  phase: "asking", venue: VENUE, night: night({ round: roundInfo(2), started: true, lockMode: "round" }), flash: null,
  ...teamBase(), self: { id: "t-team0002", name: "Les Quizerables", colour: 2, rejoinCode: "K7PX3M", jokerRound: 2, jokerAvailable: false, inSuddenDeath: false },
  questions: q,
  answers: [
    { questionId: q[0]!.id, value: { type: "text", text: "Fleetwood Mac" }, receivedAt: NOW - 60_000, counted: true },
    { questionId: q[2]!.id, value: { type: "number", value: 4 }, receivedAt: NOW - 20_000, counted: true },
  ],
  lines: lines(),
} satisfies TeamView;
