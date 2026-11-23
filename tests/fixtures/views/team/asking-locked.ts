import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

// The question locked and this team sent nothing.
export default {
  phase: "asking", venue: VENUE, night: night({ round: roundInfo(2), started: true }),
  flash: { id: 12, key: "no_answer", line: "Nothing sent. Any answer beats no answer.", teamId: "t-team0002", at: NOW - 200 },
  ...teamBase(), self: { id: "t-team0002", name: "Les Quizerables", colour: 2, rejoinCode: "K7PX3M", jokerRound: 2, jokerAvailable: false, inSuddenDeath: false },
  questions: [question(3, { status: "locked", timer: timer.done(), answered: 5 })],
  answers: [],
  lines: lines({ locked: "Answers locked. No take-backs." }),
} satisfies TeamView;
