import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

export default {
  phase: "reveal", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...hostBase(),
  teams: hostTeams(6, { totals: true }),
  round: hostRound(5, { status: "locked", timer: timer.done(), answered: 5 }),
  reveal: { question: questionHost(2, { status: "locked", timer: timer.done(), answered: 6 }), answerText: "A. Aretha Franklin", rightCount: 4 },
  standings: standings(6, 2),
  can: { "reveal.next": true, "leaderboard.show": true, "mark.team": true, "quiz.end": true },
  lines: lines({ reveal: "Drum roll, please." }),
} satisfies HostView;
