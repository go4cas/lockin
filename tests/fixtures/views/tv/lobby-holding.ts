import type { TvView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

// Holding page (T-12): planned start in 25 minutes, every panel on.
export default {
  phase: "lobby", venue: VENUE, night: night({ plannedStart: NOW + 25 * 60_000, holdingFrom: NOW - 5 * 60_000, teamCount: 12 }),
  flash: null,
  ...tvBase(),
  teams: chips(12),
  lines: lines({ lobby: "12 teams in. Room for more." }),
} satisfies TvView;
