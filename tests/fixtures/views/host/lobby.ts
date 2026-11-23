import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

// Lobby with six teams, one phone offline.
export default {
  phase: "lobby", venue: VENUE, night: night(), flash: null,
  ...hostBase(),
  teams: hostTeams(6, { offline: [4] }),
  can: { "quiz.start": true, "night.update": true, "night.close": true, "team.rename": true, "team.remove": true, "team.moveCode": true },
  lines: lines({ lobby: "Grab a drink. Pick a silly name." }),
} satisfies HostView;
