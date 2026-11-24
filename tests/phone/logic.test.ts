// B7: the phone's pure helpers (public/phone/logic.mjs) against the view fixtures.
import { describe, expect, test } from "bun:test";
import * as L from "../../public/phone/logic.mjs";
import type { TeamView } from "../../src/shared/protocol.ts";
import { loadFixtures } from "../fixtures/views/index.ts";

const fixtures = await loadFixtures();
const fx = (name: string) => structuredClone(fixtures.get(`team/${name}`)) as TeamView;
const local = { bye: null, joinMode: "join" as const, moving: false };

describe("screenOf: every team fixture has a screen", () => {
  const expected: Record<string, string> = {
    idle: "no-night", "lobby-join": "join", lobby: "lobby", round_intro: "round-intro", asking: "asking",
    "asking-round": "asking", "asking-locked": "asking", marking: "waiting", reveal: "waiting",
    leaderboard: "score", "leaderboard-30": "score", halftime: "halftime", sudden_death: "deadlock-in",
    "sudden_death-watching": "deadlock-watch", ended: "end",
  };
  for (const name of [...fixtures.keys()].filter((n) => n.startsWith("team/")).map((n) => n.slice(5))) {
    test(name, () => expect(L.screenOf(fx(name), local)).toBe(expected[name]!));
  }
  test("unbound after Quiz Start: joining is closed", () => {
    const v = fx("reveal"); v.self = null;
    expect(L.screenOf(v, local)).toBe("join-closed");
  });
  test("page state wins: moved, removed, moving, rejoin form, no view yet", () => {
    expect(L.screenOf(fx("asking"), { ...local, bye: "moved" })).toBe("moved");
    expect(L.screenOf(fx("asking"), { ...local, bye: "removed" })).toBe("removed");
    expect(L.screenOf(fx("lobby-join"), { ...local, moving: true })).toBe("moving");
    expect(L.screenOf(fx("lobby-join"), { ...local, joinMode: "rejoin" })).toBe("rejoin");
    expect(L.screenOf(null, local)).toBe("connecting");
  });
});

describe("parsePath", () => {
  test("room code from /j/, move code from /m/", () => {
    expect(L.parsePath("/j/bktw")).toEqual({ roomCode: "BKTW", moveCode: "" });
    expect(L.parsePath("/m/k7px3m2a")).toEqual({ roomCode: "", moveCode: "K7PX3M2A" });
    expect(L.parsePath("/")).toEqual({ roomCode: "", moveCode: "" });
  });
  test("ignores anything that is not a code", () => {
    expect(L.parsePath("/j/AEIO").roomCode).toBe("");
    expect(L.parsePath("/j/%3Cscript%3E").roomCode).toBe("");
    expect(L.parsePath("/j/%E0%A4%A").roomCode).toBe("");
    expect(L.parsePath("/m/TOOLONGCODE1").moveCode).toBe("");
  });
  test("cleanCode keeps only the alphabet", () => {
    expect(L.cleanCode("k7-px 3m", L.CODE_ALPHABET, 8)).toBe("K7PX3M");
    expect(L.cleanCode("b k t w x", L.ROOM_ALPHABET, 4)).toBe("BKTW");
  });
});

describe("buildValue: every answer type", () => {
  test("text: trimmed, not empty, at most 100", () => {
    expect(L.buildValue({ type: "text" }, "  Wings ")).toEqual({ ok: true, value: { type: "text", text: "Wings" } });
    expect(L.buildValue({ type: "text" }, "  ").ok).toBe(false);
    expect(L.buildValue({ type: "text" }, "x".repeat(101)).ok).toBe(false);
  });
  test("number: decimals, negatives, thousands separators", () => {
    expect(L.buildValue({ type: "number" }, "1,665")).toEqual({ ok: true, value: { type: "number", value: 1665 } });
    expect(L.buildValue({ type: "number" }, "-3.5")).toEqual({ ok: true, value: { type: "number", value: -3.5 } });
    expect(L.buildValue({ type: "number" }, "abc").ok).toBe(false);
  });
  test("choice", () => {
    const input = { type: "choice" as const, options: ["A", "B"] };
    expect(L.buildValue(input, "1")).toEqual({ ok: true, value: { type: "choice", index: 1 } });
    expect(L.buildValue(input, "2").ok).toBe(false);
  });
  test("datetime: year, date, time in the spec's shapes", () => {
    expect(L.buildValue({ type: "datetime", precision: "year" }, "1989")).toEqual({ ok: true, value: { type: "datetime", value: "1989" } });
    expect(L.buildValue({ type: "datetime", precision: "year" }, "800")).toEqual({ ok: true, value: { type: "datetime", value: "0800" } });
    expect(L.buildValue({ type: "datetime", precision: "date" }, "1969-07-20")).toEqual({ ok: true, value: { type: "datetime", value: "1969-07-20" } });
    expect(L.buildValue({ type: "datetime", precision: "time" }, "20:17")).toEqual({ ok: true, value: { type: "datetime", value: "20:17" } });
    expect(L.buildValue({ type: "datetime", precision: "date" }, "").ok).toBe(false);
  });
  test("draftMatches tells sent from changed", () => {
    const held = { questionId: "q", value: { type: "text" as const, text: "Wings" }, receivedAt: 0, counted: true };
    expect(L.draftMatches({ type: "text" }, " Wings", held)).toBe(true);
    expect(L.draftMatches({ type: "text" }, "Wing", held)).toBe(false);
    expect(L.draftMatches({ type: "text" }, "Wings", null)).toBe(false);
    expect(L.draftOf(held.value)).toBe("Wings");
  });
});

describe("reading the view", () => {
  test("formatValue", () => {
    expect(L.formatValue({ type: "choice", index: 1 }, { type: "choice", options: ["Jupiter", "Saturn"] })).toBe("B, Saturn");
    expect(L.formatValue({ type: "datetime", value: "1969-07-20" })).toBe("20 July 1969");
    expect(L.formatValue({ type: "number", value: 4 })).toBe("4");
  });
  test("ordinal", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(L.ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
  });
  test("myRow finds this team's standing", () => {
    const row = L.myRow(fx("leaderboard"))!;
    expect(row.teamId).toBe("t-team0002");
    expect(row.position).toBe(2);
    expect(L.myRow(fx("lobby"))).toBeNull();
  });
  test("decidedLine", () => {
    expect(L.decidedLine({ shared: false, decidedBy: "tie_breaker" })).toBe("Tied on points, ahead on round wins");
    expect(L.decidedLine({ shared: true, decidedBy: "shared" })).toBe("Shared with another team");
    expect(L.decidedLine({ shared: false, decidedBy: "points" })).toBe("");
  });
  test("prizeFor", () => {
    expect(L.prizeFor(fx("ended"), 1)?.text).toBe("A round of drinks");
    expect(L.prizeFor(fx("ended"), 5)).toBeNull();
  });
  test("liveQuestions and pickQuestion", () => {
    const round = fx("asking-round");
    expect(L.liveQuestions(round).length).toBe(5);
    expect(L.pickQuestion(round.questions, round.questions[3]!.id)!.number).toBe(4);
    expect(L.pickQuestion(round.questions, "gone")!.number).toBe(1);
    expect(L.liveQuestions(fx("sudden_death"))[0]!.id).toBe("q-sd000001");
  });
  test("answerFor", () => {
    const v = fx("asking");
    expect(L.answerFor(v, v.questions[0]!.id)!.value).toEqual({ type: "choice", index: 0 });
    expect(L.answerFor(v, "nope")).toBeNull();
  });
  test("progressLabel", () => {
    const v = fx("asking");
    expect(L.progressLabel(v, v.questions[0]!)).toBe("R3 · Q2 of 5");
    expect(L.progressLabel(fx("asking-round"), null)).toBe("Round 3");
  });
  test("timerLeft for each timer state", () => {
    expect(L.timerLeft({ state: "running", durationMs: 60_000, locksAt: 50_000, remainingMs: null }, 20_000)).toBe(30_000);
    expect(L.timerLeft({ state: "running", durationMs: 60_000, locksAt: 50_000, remainingMs: null }, 60_000)).toBe(0);
    expect(L.timerLeft({ state: "paused", durationMs: 60_000, locksAt: null, remainingMs: 12_000 }, 0)).toBe(12_000);
    expect(L.timerLeft({ state: "idle", durationMs: 60_000, locksAt: null, remainingMs: null }, 0)).toBeNull();
    expect(L.timerLeft({ state: "done", durationMs: 60_000, locksAt: 1, remainingMs: null }, 0)).toBe(0);
  });
});

describe("joker (P-04)", () => {
  test("lobby offers round 1, round_intro the upcoming round", () => {
    expect(L.jokerRoundNow(fx("lobby"))).toBe(0);
    const ri = fx("round_intro"); ri.self!.jokerRound = null; ri.self!.jokerAvailable = true;
    expect(L.jokerRoundNow(ri)).toBe(2);
  });
  test("leaderboard and halftime offer the next round, never after the last", () => {
    const lb = fx("leaderboard"); lb.self!.jokerAvailable = true;
    expect(L.jokerRoundNow(lb)).toBe(3);
    lb.night!.round = { ...lb.night!.round!, index: 5, isLast: true };
    expect(L.jokerRoundNow(lb)).toBeNull();
  });
  test("not while asking, not when used or off", () => {
    const a = fx("asking"); a.self!.jokerAvailable = true;
    expect(L.jokerRoundNow(a)).toBeNull();
    expect(L.jokerRoundNow(fx("round_intro"))).toBeNull();
    const off = fx("lobby"); off.night!.joker = false;
    expect(L.jokerRoundNow(off)).toBeNull();
    expect(L.jokerStatus(off)).toBeNull();
  });
  test("jokerStatus", () => {
    expect(L.jokerStatus(fx("lobby"))).toBe("Still available");
    expect(L.jokerStatus(fx("leaderboard"))).toBe("Played on round 3");
  });
});

describe("team storage (11.1)", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage; };
  test("saves, loads and clears under lockin.team", () => {
    const s = mem();
    expect(L.loadTeam(s)).toBeNull();
    L.saveTeam(s, { nightId: "n", teamId: "t", token: "tok" });
    expect(s.getItem("lockin.team")).toBe(JSON.stringify({ nightId: "n", teamId: "t", token: "tok" }));
    expect(L.loadTeam(s)).toEqual({ nightId: "n", teamId: "t", token: "tok" });
    L.saveTeam(s, null);
    expect(L.loadTeam(s)).toBeNull();
  });
  test("survives broken or blocked storage", () => {
    const s = mem(); s.setItem("lockin.team", "{oops");
    expect(L.loadTeam(s)).toBeNull();
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } as unknown as Storage;
    expect(L.loadTeam(blocked)).toBeNull();
    expect(() => L.saveTeam(blocked, { nightId: "n", teamId: "t", token: "x" })).not.toThrow();
  });
});

test("isApple", () => {
  expect(L.isApple("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
  expect(L.isApple("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
});
