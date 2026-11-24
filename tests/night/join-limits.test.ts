// SA-01 (room code guessing), D1 (join key, new room code) and SA-04 / LI-011 (refusals
// never copy the night), against the engine on fake time.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { hostView, displayView, teamView } from "../../src/server/night/views.ts";
import { JOIN_PAUSE_MS, JOIN_TRIES_TOTAL, ROOM_ALPHABET } from "../../src/server/night/engine.ts";
import type { Actor } from "../../src/server/night/engine.ts";
import { code, host, joinTeam, makeQuiz, q, rig, text, writeQuiz, type Rig } from "./fakes.ts";

const rigs: Rig[] = [];
afterEach(() => { while (rigs.length) rigs.pop()!.close(); });

function setup() {
  const r = rig();
  rigs.push(r);
  writeQuiz(r.dataDir, makeQuiz("friday", [[q(text("Fleetwood Mac")), q(text("Abbey Road"))]], { maxTeams: 30 }));
  host(r, "night.open", { quizId: "friday" });
  return r;
}

let connId = 50_000;
const phone = (ip = "203.0.113.7"): Actor & { role: "team" } => ({ role: "team", teamId: null, connId: connId++, ip });

/** A room code that is not this night's. */
function wrongCode(r: Rig, n = 0): string {
  const right = r.engine.m!.night.roomCode;
  let i = n;
  for (;;) {
    const c = [0, 1, 2, 3].map((k) => ROOM_ALPHABET[(i * 7 + k * 3) % ROOM_ALPHABET.length]).join("");
    if (c !== right) return c;
    i++;
  }
}
const join = (r: Rig, a: Actor, args: Record<string, unknown>) => code(r.engine.command(a, "team.join", args));

describe("room code limits (SA-01 part A)", () => {
  test("20 wrong codes on one socket: at most 3 room_code, then too_many_tries", () => {
    const r = setup();
    const p = phone();
    const answers = Array.from({ length: 20 }, (_, i) => join(r, p, { roomCode: wrongCode(r, i), name: "x" }));
    expect(answers.filter((c) => c === "room_code").length).toBe(3);
    expect(answers.slice(3).every((c) => c === "too_many_tries")).toBe(true);
  });

  test("wrong codes on fresh sockets from one IP stop at 10 a minute; after a minute they count again", () => {
    const r = setup();
    const answers = Array.from({ length: 15 }, (_, i) => join(r, phone("198.51.100.9"), { roomCode: wrongCode(r, i), name: "x" }));
    expect(answers.filter((c) => c === "room_code").length).toBe(10);
    expect(answers.slice(10).every((c) => c === "too_many_tries")).toBe(true);
    // another address in the same pub is not affected
    expect(join(r, phone("198.51.100.10"), { roomCode: r.engine.m!.night.roomCode, name: "Quizzy" })).toBe("ok");
    r.advance(60_001);
    expect(join(r, phone("198.51.100.9"), { roomCode: wrongCode(r), name: "x" })).toBe("room_code");
  });

  test("wrong codes from many IPs stop at 30 a minute in total; the host is warned; typed joins pause for a minute", () => {
    const r = setup();
    const answers = Array.from({ length: 40 }, (_, i) => join(r, phone(`192.0.2.${i}`), { roomCode: wrongCode(r, i), name: "x" }));
    expect(answers.filter((c) => c === "room_code").length).toBe(JOIN_TRIES_TOTAL);
    expect(answers.slice(JOIN_TRIES_TOTAL).every((c) => c === "too_many_tries")).toBe(true);
    expect(r.engine.joinPausedUntil).toBe(r.clock.now() + JOIN_PAUSE_MS);
    expect(r.events.some((e) => e.hostOnly)).toBe(true);   // the host view was sent with the warning

    // no oracle: the right code, with a good or a bad name, gets the same answer while paused
    const right = r.engine.m!.night.roomCode;
    expect(join(r, phone("192.0.2.200"), { roomCode: right, name: "" })).toBe("too_many_tries");
    expect(join(r, phone("192.0.2.201"), { roomCode: right, name: "Real team" })).toBe("too_many_tries");

    r.advance(JOIN_PAUSE_MS + 1);
    expect(join(r, phone("192.0.2.202"), { roomCode: right, name: "Real team" })).toBe("ok");
  });

  test("a right code with a bad name after the per-socket limit also answers too_many_tries", () => {
    const r = setup();
    const p = phone();
    for (let i = 0; i < 3; i++) join(r, p, { roomCode: wrongCode(r, i), name: "x" });
    expect(join(r, p, { roomCode: r.engine.m!.night.roomCode, name: "" })).toBe("too_many_tries");
  });

  test("a wrong code is room_code whatever the other args are", () => {
    const r = setup();
    expect(join(r, phone(), { roomCode: wrongCode(r), name: "" })).toBe("room_code");
    expect(join(r, phone(), { roomCode: wrongCode(r), name: 42 })).toBe("room_code");
    expect(join(r, phone(), { roomCode: 7 })).toBe("room_code");
  });

  test("30 phones on one pub IP all join with the typed code", () => {
    const r = setup();
    for (let i = 0; i < 30; i++) expect(join(r, phone("203.0.113.50"), { roomCode: r.engine.m!.night.roomCode, name: `Team ${i}` })).toBe("ok");
  });
});

describe("join key and new room code (D1, SA-01 part B)", () => {
  test("while typed joins are paused, the join key from the QR code still gets in", () => {
    const r = setup();
    for (let i = 0; i < JOIN_TRIES_TOTAL; i++) join(r, phone(`192.0.2.${i}`), { roomCode: wrongCode(r, i), name: "x" });
    const right = r.engine.m!.night.roomCode;
    const key = r.engine.state.joinKey!;
    expect(join(r, phone(), { roomCode: right, name: "Typed" })).toBe("too_many_tries");
    expect(join(r, phone(), { roomCode: right, joinKey: key, name: "Scanned" })).toBe("ok");
    expect(join(r, phone(), { roomCode: right, joinKey: key.toLowerCase(), name: "Scanned 2" })).toBe("ok");
    // a wrong key is a typed join: still paused
    expect(join(r, phone(), { roomCode: right, joinKey: "23456789AB", name: "Guess" })).toBe("too_many_tries");
  });

  test("the join key is in the join link, never for an unbound phone or an unpaired display", () => {
    const r = setup();
    const key = r.engine.state.joinKey!;
    expect(key).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
    expect(hostView(r.engine).night!.joinUrl).toEndWith(`/j/${r.engine.m!.night.roomCode}-${key}`);
    expect(displayView(r.engine).night!.joinUrl).toContain(key);
    expect(JSON.stringify(teamView(r.engine, null))).not.toContain(key);
  });

  test("night.newRoomCode changes the code and key, keeps the teams, and clears a pause", () => {
    const r = setup();
    const team = joinTeam(r, "Stayers");
    const old = { code: r.engine.m!.night.roomCode, key: r.engine.state.joinKey! };
    for (let i = 0; i < JOIN_TRIES_TOTAL; i++) join(r, phone(`192.0.2.${i}`), { roomCode: wrongCode(r, i + 100), name: "x" });
    expect(r.engine.joinPausedUntil).toBeGreaterThan(r.clock.now());

    const res = host(r, "night.newRoomCode") as { roomCode: string };
    expect(res.roomCode).not.toBe(old.code);
    expect(r.engine.m!.night.roomCode).toBe(res.roomCode);
    expect(r.engine.state.joinKey).not.toBe(old.key);
    expect(r.engine.joinPausedUntil).toBe(0);
    expect(r.engine.teams().map((t) => t.id)).toEqual([team.teamId]);
    expect(join(r, phone(), { roomCode: old.code, joinKey: old.key, name: "Late" })).toBe("room_code");
    expect(join(r, phone(), { roomCode: res.roomCode, name: "New" })).toBe("ok");

    // both survive a restart
    const r2 = r.restart();
    rigs.splice(rigs.indexOf(r), 1, r2);
    expect(r2.engine.m!.night.roomCode).toBe(res.roomCode);
    expect(r2.engine.state.joinKey).toBe(r.engine.state.joinKey!);
  });

  test("night.newRoomCode is allowed until the night ends (the hub keeps it to hosts, see hardening)", () => {
    const r = setup();
    expect(hostView(r.engine).can["night.newRoomCode"]).toBe(true);
    joinTeam(r, "A");
    host(r, "quiz.start");
    expect(hostView(r.engine).can["night.newRoomCode"]).toBe(true);
    host(r, "quiz.end", { early: true });
    expect(hostView(r.engine).can["night.newRoomCode"]).toBe(false);
  });
});

describe("refusals do not copy the night (SA-04 step 4, LI-011)", () => {
  test("wrong room codes, wrong rejoin codes, bad answers and repeated answers: no clone, no seq change", () => {
    const r = setup();
    const team = joinTeam(r, "Answerers");
    const clone = spyOn(globalThis, "structuredClone");
    try {
      const seq = r.engine.state.seq;
      clone.mockClear();
      join(r, phone(), { roomCode: wrongCode(r), name: "x" });
      expect(code(r.engine.command(phone(), "team.rejoin", { code: "ZZZZZZ" }))).toBe("bad_code");
      expect(code(r.engine.command(team, "joker.play", { round: 0 }))).toBe("joker_off");
      host(r, "quiz.start");
      host(r, "round.start");
      host(r, "question.next");
      const qid = r.engine.currentQuestionId()!;
      clone.mockClear();
      const seq2 = r.engine.state.seq;
      expect(code(r.engine.command(team, "answer.submit", { questionId: qid, value: { type: "choice", index: 0 } }))).toBe("bad_args");
      expect(code(r.engine.command(team, "answer.submit", { questionId: "q-nothere", value: { type: "text", text: "x" } }))).toBe("question_closed");
      expect(clone).not.toHaveBeenCalled();
      expect(r.engine.state.seq).toBe(seq2);
      // the first answer is a change; the same answer again is not
      expect(code(r.engine.command(team, "answer.submit", { questionId: qid, value: { type: "text", text: "Rumours" } }))).toBe("ok");
      expect(clone).toHaveBeenCalledTimes(1);
      const seq3 = r.engine.state.seq;
      const events = r.events.length;
      expect(code(r.engine.command(team, "answer.submit", { questionId: qid, value: { type: "text", text: "Rumours" } }))).toBe("ok");
      expect(clone).toHaveBeenCalledTimes(1);
      expect(r.engine.state.seq).toBe(seq3);
      expect(r.events.length).toBe(events);
      expect(seq).toBeLessThan(seq2);
    } finally {
      clone.mockRestore();
    }
  });
});
