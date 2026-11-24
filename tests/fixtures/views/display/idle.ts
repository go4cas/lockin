import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , displayBase, teamBase } from "../_data.ts";

export default {
  phase: "idle", venue: VENUE, night: null, flash: null,
  ...displayBase(),
  lines: lines(),
} satisfies DisplayView;
