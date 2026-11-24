import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// Join page on an unbound connection while a night is open (P-02).
export default {
  phase: "lobby", venue: VENUE, night: night(), flash: null,
  ...teamBase(), self: null,
  teams: chips(5),
  lines: lines({ lobby: "Name your team. Choose wisely, it goes on the telly." }),
} satisfies TeamView;
