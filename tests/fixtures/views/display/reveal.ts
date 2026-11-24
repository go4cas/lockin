import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

export default {
  phase: "reveal", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...displayBase(),
  teams: chips(6, [1]),
  reveal: { question: question(2, { status: "locked", timer: timer.done(), answered: 6 }), answerText: "A. Aretha Franklin", rightCount: 4 },
  lines: lines({ reveal: "Drum roll, please." }),
} satisfies DisplayView;
