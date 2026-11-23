import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

export default {
  phase: "ended", venue: VENUE, night: night({ round: null, started: true }), flash: null,
  ...hostBase(),
  teams: hostTeams(6, { totals: true }),
  standings: standings(6, 5),
  can: { "night.close": true, "mark.team": true, "team.rename": true },
  lines: lines({ winner: "Quizteama Aguilera, champions of The Example Arms!", goodbye: "Drink up, get home safe." }),
} satisfies HostView;
