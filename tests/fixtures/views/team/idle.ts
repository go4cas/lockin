import type { TeamView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

// No night open: the join page has nothing to join.
export default {
  phase: "idle", venue: VENUE, night: null, flash: null,
  ...teamBase(), self: null,
  lines: lines(),
} satisfies TeamView;
