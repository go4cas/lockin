// CopyPicker (TECH-SPEC 5.5, 8.6, S-10).
import { describe, expect, test } from "bun:test";
import copyFile from "../../assets/copy.en.json" with { type: "json" };
import { createCopyPicker, fillLine, mergePools, poolsFromCopyFile, type Pools } from "../../src/server/branding/copy.ts";
import { startTestServer } from "../helpers/server.ts";

const ENGINE_KEYS = [
  "lobby", "team_joined", "round_start", "last_seconds", "locked", "all_locked", "no_answer", "joker_played", "reveal",
  "lead_change", "lead_change_shared", "big_climb", "close_race", "halftime", "tie_breaker", "sudden_death", "sudden_death_again",
  "sudden_death_won", "sudden_death_shared", "winner", "winner_shared", "last_place", "goodbye",
];

const picker = (pools: Pools, name: string | null = null, random = Math.random) => createCopyPicker(() => pools, () => name, random);

describe("default pools", () => {
  test("copy.en.json gives every pool key the engine uses (5.5), plus taglines, and no tiebreak", () => {
    const pools = poolsFromCopyFile(copyFile);
    for (const k of ENGINE_KEYS) expect(pools[k]?.length ?? 0).toBeGreaterThan(0);
    expect(pools.taglines!.length).toBeGreaterThan(0);
    expect(pools.tiebreak).toBeUndefined();
    expect(Object.keys(pools)).not.toContain("$comment");
  });
});

describe("mergePools", () => {
  const defaults: Pools = { lobby: ["a", "b"], winner: ["w"] };
  test("replace swaps the pool, add appends, other pools stay", () => {
    const m = mergePools(defaults, { lobby: { mode: "replace", lines: ["x"] }, winner: { mode: "add", lines: ["v"] }, custom: { mode: "add", lines: ["c"] } });
    expect(m).toEqual({ lobby: ["x"], winner: ["w", "v"], custom: ["c"] });
    expect(defaults.lobby).toEqual(["a", "b"]);
  });
});

describe("fillLine", () => {
  test("fills every placeholder", () => {
    expect(fillLine("{team} at {pub}: round {round}, {n} teams, {seconds}s", { team: "Quizzly Bears", pub: "The Example Arms", round: 3, n: 4, seconds: 10 }))
      .toBe("Quizzly Bears at The Example Arms: round 3, 4 teams, 10s");
  });
  test("skips a line whose placeholder has no value", () => {
    expect(fillLine("Thanks for playing at {pub}.", {})).toBeNull();
    expect(fillLine("Thanks for playing at {pub}.", { pub: "" })).toBeNull();
  });
  test("skips {n} lines when n < 2", () => {
    expect(fillLine("{n} teams in.", { n: 1 })).toBeNull();
    expect(fillLine("{n} teams in.", { n: 0 })).toBeNull();
    expect(fillLine("{n} teams in.", { n: 2 })).toBe("2 teams in.");
  });
  test("skips lines with an unknown placeholder rather than showing braces", () => {
    expect(fillLine("Hello {nobody}", { team: "x" })).toBeNull();
  });
  test("round 0 is a value", () => {
    expect(fillLine("Round {round}", { round: 0 })).toBe("Round 0");
  });
});

describe("CopyPicker.pick", () => {
  test("a missing or empty pool gives no line", () => {
    expect(picker({ empty: [] }).pick("nothing", {}, {})).toBeNull();
    expect(picker({ empty: [] }).pick("empty", {}, {})).toBeNull();
  });

  test("never repeats the last line when the pool has more than one usable line", () => {
    const p = picker({ lobby: ["a", "b", "c"] });
    const last: Record<string, number> = {};
    let prev = -1;
    for (let i = 0; i < 300; i++) {
      const r = p.pick("lobby", {}, last)!;
      expect(r.index).not.toBe(prev);
      expect(r.text).toBe(["a", "b", "c"][r.index]!);
      prev = r.index;
      last.lobby = r.index;
    }
  });

  test("uses every line over time", () => {
    const p = picker({ lobby: ["a", "b", "c", "d"] });
    const seen = new Set<number>();
    const last: Record<string, number> = {};
    for (let i = 0; i < 200; i++) { const r = p.pick("lobby", {}, last)!; seen.add(r.index); last.lobby = r.index; }
    expect(seen.size).toBe(4);
  });

  test("the last index is per pool", () => {
    const p = picker({ a: ["x", "y"], b: ["x", "y"] }, null, () => 0);
    expect(p.pick("a", {}, { a: 0, b: 1 })!.index).toBe(1);
    expect(p.pick("b", {}, { a: 0, b: 1 })!.index).toBe(0);
  });

  test("a pool with one usable line repeats it", () => {
    const p = picker({ lobby: ["only one", "{n} teams in"] });
    expect(p.pick("lobby", { n: 1 }, { lobby: 0 })).toEqual({ text: "only one", index: 0 });
  });

  test("returns the index in the merged pool, skipping unusable lines", () => {
    const p = picker({ winner: ["{team} at {pub}", "{team} wins"] }, null, () => 0);
    expect(p.pick("winner", { team: "Quizzly Bears" }, {})).toEqual({ text: "Quizzly Bears wins", index: 1 });
  });

  test("{pub} defaults to the venue name", () => {
    const p = picker({ goodbye: ["Thanks for playing at {pub}."] }, "The Example Arms");
    expect(p.pick("goodbye", {}, {})!.text).toBe("Thanks for playing at The Example Arms.");
    expect(p.pick("goodbye", { pub: "Elsewhere" }, {})!.text).toBe("Thanks for playing at Elsewhere.");
    expect(picker({ goodbye: ["Thanks for playing at {pub}."] }).pick("goodbye", {}, {})).toBeNull();
  });

  test("{n} lines are skipped below two", () => {
    const p = picker({ lobby: ["{n} teams in so far.", "Grab a drink."] });
    for (let i = 0; i < 20; i++) expect(p.pick("lobby", { n: 1 }, {})!.text).toBe("Grab a drink.");
  });
});

describe("the server's copy picker", () => {
  test("is app.services.copyPicker and follows the saved theme's copy and name", async () => {
    const s = await startTestServer();
    try {
      const picker = s.app.services.copyPicker;
      expect(picker.pick("team_joined", { team: "Quizzly Bears" }, {})!.text).toContain("Quizzly Bears");
      const cookie = await s.signIn();
      const res = await s.fetch("/api/theme", {
        method: "PUT", cookie,
        body: JSON.stringify({ theme: { format: "lockin.theme/1", name: "The Example Arms", copy: { goodbye: { mode: "replace", lines: ["Night from {pub}."] } } } }),
      });
      expect(res.status).toBe(200);
      expect(picker.pick("goodbye", {}, {})).toEqual({ text: "Night from The Example Arms.", index: 0 });
    } finally {
      await s.stop();
    }
  });
});
