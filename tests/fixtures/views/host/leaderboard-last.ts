import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

// After the last round: three teams tied for first, so Deadlock is needed.
export default {
  phase: "leaderboard", venue: VENUE, night: night({ round: roundInfo(5), started: true }), flash: null,
  ...hostBase(),
  teams: hostTeams(6, { totals: true }),
  standings: standings(6, 5),
  suddenDeathNeeded: { position: 1, teamIds: [teamId(0), teamId(1), teamId(2)] },
  can: { "sd.start": true, "mark.team": true, "quiz.end": false },
  lines: lines({ leaderboard: "Top two within a point. Squeaky bum time." }),
} satisfies HostView;
