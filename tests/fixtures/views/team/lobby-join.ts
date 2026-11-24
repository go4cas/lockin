import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// Join page on an unbound connection while a night is open (P-02). Since SA-07 (D3) an unbound
// phone gets only phase, venue, night.started and the lobby line; the rest is blank.
export default {
  phase: "lobby", venue: VENUE,
  night: {
    ...night(), id: "", roomCode: "", joinUrl: "", quizTitle: "", plannedStart: null, holdingFrom: null, holdingPanels: [], prizes: [],
    roundCount: 0, round: null, joker: false, lockMode: "question", teamCount: 0, started: false,
  },
  flash: null,
  ...teamBase(), self: null,
  teams: [],
  lines: lines({ lobby: "Name your team. Choose wisely, it goes on the telly." }),
} satisfies TeamView;
