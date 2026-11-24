import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

export default {
  phase: "round_intro", venue: VENUE, night: night({ round: roundInfo(2), started: true }),
  flash: { id: 9, key: "joker_played", line: "Les Quizerables have played their joker.", teamId: "t-team0002", at: NOW - 500 },
  ...displayBase(),
  teams: chips(6, [1]),
  lines: lines({ round: "Round 3. Heads together." }),
} satisfies DisplayView;
