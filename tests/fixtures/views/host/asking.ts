import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

// Per-question mode, question 2 on screen with its answer and note; question 1 is locked and being marked.
export default {
  phase: "asking", venue: VENUE, night: night({ round: roundInfo(2), started: true }), flash: null,
  ...hostBase(),
  teams: hostTeams(6, { answered: 4, totals: true }),
  round: { questions: [questionHost(1, { status: "locked", timer: timer.done(), answered: 5 }), questionHost(2), questionHost(3, { timer: timer.idle(), answered: 0 }), questionHost(4, { timer: timer.idle(), answered: 0 }), questionHost(5, { timer: timer.idle(), answered: 0 })], shown: 2 },
  current: questionHost(2),
  marking: { questions: marking(6, 1), pendingTotal: 2 },
  standings: standings(6, 1),
  can: { "timer.pause": true, "timer.add": true, lock: true, "mark.group": true, "mark.team": true, "quiz.end": true },
  lines: lines({ question: "Round 3. Heads together." }),
} satisfies HostView;
