import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

// Deadlock question locked; ready to reveal.
const sd = suddenDeath("locked");
export default {
  phase: "sudden_death", venue: VENUE, night: night({ round: roundInfo(5), started: true }), flash: null,
  ...hostBase(),
  teams: hostTeams(6, { totals: true }),
  standings: standings(6, 5),
  suddenDeath: {
    ...sd,
    questionHost: { ...sd.question!, answer: { type: "closest", value: 8 }, note: null, answerText: "8" },
    marking: null,
  },
  can: { "sd.reveal": true },
  lines: lines({ suddenDeath: "Deadlock. One question. No mercy." }),
} satisfies HostView;
