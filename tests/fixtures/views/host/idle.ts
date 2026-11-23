import type { HostView } from "../../../../src/shared/protocol.ts";
import { NOW, VENUE, chips, hostBase, hostRound, hostTeams, lines, marking, night, questionHost, roundInfo, standings, suddenDeath, teamId, timer } from "../_data.ts";

export default {
  phase: "idle", venue: VENUE, night: null, flash: null,
  ...hostBase(),
  can: { "night.open": true },
} satisfies HostView;
