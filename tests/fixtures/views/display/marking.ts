import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// Host is marking; the display holds on the round.
export default {
  phase: "marking", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...displayBase(),
  teams: chips(6, [1]),
  lockedMoment: { at: NOW - 20_000, all: false },
  lines: lines({ locked: "Answers locked. No take-backs." }),
} satisfies DisplayView;
