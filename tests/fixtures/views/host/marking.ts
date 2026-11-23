import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

// Every question locked; two typed answers still to mark, so reveal is blocked.
export default {
  phase: "marking", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...hostBase(),
  teams: hostTeams(6, { totals: true }),
  round: hostRound(5, { status: "locked", timer: timer.done(), answered: 5 }),
  marking: { questions: marking(6, 5), pendingTotal: 2 },
  standings: standings(6, 1),
  can: { "mark.group": true, "mark.team": true, "reveal.start": false, "leaderboard.show": false, "quiz.end": true },
  lines: lines({ locked: "Answers locked. No take-backs." }),
} satisfies HostView;
