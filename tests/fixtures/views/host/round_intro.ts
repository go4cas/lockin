import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

export default {
  phase: "round_intro", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...hostBase(),
  teams: hostTeams(6, { totals: true }),
  round: hostRound(0),
  standings: standings(6, 1),
  can: { "round.start": true, "quiz.end": true, "team.rename": true, "team.moveCode": true },
  lines: lines({ round: "Round 3. Heads together." }),
} satisfies HostView;
