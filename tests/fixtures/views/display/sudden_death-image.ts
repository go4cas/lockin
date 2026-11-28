import type { DisplayView } from "../../../../src/shared/protocol.ts";
import { VENUE, chips, lines, night, roundInfo, standings, suddenDeath, displayBase } from "../_data.ts";

// Deadlock with a picture question (UI-62): the picture beside the question, the face-off under it.
const sd = suddenDeath("open");
export default {
  phase: "sudden_death", venue: VENUE, night: night({ round: roundInfo(5), started: true }), flash: null,
  ...displayBase(),
  teams: chips(6),
  standings: standings(6, 5),
  suddenDeath: { ...sd, question: { ...sd.question!, text: "Name this album cover.", image: `/media/q/${sd.question!.id}`, input: { type: "text" } } },
  lines: lines({ suddenDeath: "Deadlock. One question. No mercy." }),
} satisfies DisplayView;
