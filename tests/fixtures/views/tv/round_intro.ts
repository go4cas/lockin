import type { TvView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

export default {
  phase: "round_intro", venue: VENUE, night: night({ round: roundInfo(2), started: true }),
  flash: { id: 9, key: "joker_played", line: "Les Quizerables have played their joker.", teamId: "t-team0002", at: NOW - 500 },
  ...tvBase(),
  teams: chips(6, [1]),
  lines: lines({ round: "Round 3. Heads together." }),
} satisfies TvView;
