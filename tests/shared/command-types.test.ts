// Code review LI-019: command arguments and results are typed across the server and browser
// boundary. The @ts-expect-error lines below are the test: `bun run typecheck` fails if any of
// them stops being an error (a renamed argument or result field would then go unnoticed).
// The runtime part checks the registry the types are built on.

import { describe, expect, test } from "bun:test";
import type { LockInClient } from "../../src/shared/client-api.ts";
import { COMMANDS, COMMAND_NAMES, TEAM_COMMANDS, type CommandArgs, type CommandName, type CommandResults } from "../../src/shared/protocol.ts";

declare const client: LockInClient;
declare const send: typeof import("../../public/host/run/state.js").send;

// Never called: only typechecked.
export async function typesOnly(): Promise<void> {
  await client.cmd("team.rename", { teamId: "t-1", name: "Quizzy Rascals" });
  // @ts-expect-error `teamid` is not an argument of team.rename
  await client.cmd("team.rename", { teamid: "t-1", name: "Quizzy Rascals" });
  // @ts-expect-error team.join needs a name
  await client.cmd("team.join", { roomCode: "BCDF" });
  // @ts-expect-error an answer value has a type
  await client.cmd("answer.submit", { questionId: "q-1", value: { text: "Paris" } });
  // @ts-expect-error not a command
  await client.cmd("night.reopen", {});

  const opened = await client.cmd("night.open", { quizId: "friday" });
  opened.roomCode.toUpperCase();
  // @ts-expect-error night.open answers nightId, not id
  void opened.id;
  const joined = await client.cmd("team.join", { roomCode: "BCDF", name: "Les Quizerables" });
  joined.token.length;
  // @ts-expect-error team.join answers no rejoin code
  void joined.rejoinCode;

  // The console's send() carries the same types (public/host/run/state.js).
  const paired = await send("display.pair", { code: "123456" });
  if (paired.ok) paired.result.connectedFor.toFixed();
  // @ts-expect-error display.pair takes a code, not a pin
  await send("display.pair", { pin: "123456" });
  // @ts-expect-error mark.team takes "correct" or "wrong"
  await send("mark.team", { questionId: "q-1", teamId: "t-1", mark: "right" });
}

describe("command registry (LI-016, LI-019)", () => {
  test("every command is in the registry once, with argument and result types", () => {
    const names: CommandName[] = [...COMMAND_NAMES];
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(Object.keys(COMMANDS).length);
    // keyof checks are compile-time; this keeps the lists honest at run time too.
    const args: Record<keyof CommandArgs, true> = Object.fromEntries(names.map((n) => [n, true])) as Record<CommandName, true>;
    const results: Record<keyof CommandResults, true> = args;
    expect(Object.keys(results).sort()).toEqual([...names].sort());
  });

  test("team commands are exactly the four a phone sends (7.2)", () => {
    expect([...TEAM_COMMANDS]).toEqual(["team.join", "team.rejoin", "joker.play", "answer.submit"]);
  });
});
