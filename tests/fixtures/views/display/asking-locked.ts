import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// The padlock moment: the question has just locked (lockedMoment set).
export default {
  phase: "asking", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...displayBase(),
  teams: chips(6, [1]),
  question: question(2, { status: "locked", timer: timer.done(), answered: 6 }),
  lockedMoment: { at: NOW - 300, all: true },
  lines: lines({ locked: "Everyone's in. Pens down, phones up." }),
} satisfies DisplayView;
