import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

// Per-round mode: all five shown, round timer paused.
export default {
  phase: "asking", venue: VENUE, night: night({ round: roundInfo(2), started: true, lockMode: "round" }), flash: null,
  ...hostBase(),
  teams: hostTeams(6, { answered: 3, totals: true }),
  round: hostRound(5, { timer: timer.paused(300, 140), answered: 3 }),
  current: questionHost(5, { timer: timer.paused(300, 140), answered: 3 }),
  standings: standings(6, 1),
  can: { "timer.resume": true, "timer.add": true, lock: true, "quiz.end": true },
  lines: lines(),
} satisfies HostView;
