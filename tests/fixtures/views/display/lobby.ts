import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// Plain lobby (T-02): before the holding page starts.
export default {
  phase: "lobby", venue: VENUE, night: night({ plannedStart: NOW + 90 * 60_000, holdingFrom: NOW + 60 * 60_000 }),
  flash: { id: 3, key: "team_joined", line: "Tequila Mockingbird has entered the building.", teamId: "t-team0006", at: NOW - 1_000 },
  ...displayBase(),
  teams: chips(6),
  lines: lines({ lobby: "Grab a drink. Pick a silly name." }),
} satisfies DisplayView;
