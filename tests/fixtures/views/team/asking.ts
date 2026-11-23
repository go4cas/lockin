import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

// Per-question mode: multiple choice, answer received.
export default {
  phase: "asking", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...teamBase(), self: { id: "t-team0002", name: "Les Quizerables", colour: 2, rejoinCode: "K7PX3M", jokerRound: 2, jokerAvailable: false, inSuddenDeath: false },
  questions: [question(2)],
  answers: [{ questionId: question(2).id, value: { type: "choice", index: 0 }, receivedAt: NOW - 4_000, counted: true }],
  lines: lines({ question: "Round 3. Heads together." }),
} satisfies TeamView;
