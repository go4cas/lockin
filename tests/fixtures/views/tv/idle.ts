import type { TvView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, lines, night, question, roundInfo, standings, suddenDeath, timer , tvBase, teamBase } from "../_data.ts";

export default {
  phase: "idle", venue: VENUE, night: null, flash: null,
  ...tvBase(),
  lines: lines(),
} satisfies TvView;
