// TECH-SPEC 13.2: a sample view for every role and phase. `bun run typecheck`
// proves each matches the contract (every file is `satisfies <Role>View`).
import { beforeAll, describe, expect, test } from "bun:test";
import { PHASES, type View } from "../../src/shared/protocol.ts";
import { loadFixtures } from "./views/index.ts";

let fixtures: Map<string, View>;
beforeAll(async () => { fixtures = await loadFixtures(); });

/** Every key anywhere in a JSON value. */
function keys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keys(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keys(x, out); }
  return out;
}

describe("view fixtures", () => {
  test("every role has a fixture for every phase", () => {
    for (const role of ["host", "display", "team"]) {
      for (const phase of PHASES) expect(fixtures.has(`${role}/${phase}`)).toBe(true);
    }
  });

  test("each fixture's role and phase match its name", () => {
    for (const [name, view] of fixtures) {
      const [role, file] = name.split("/") as [string, string];
      expect(`${name}: ${view.role}`).toBe(`${name}: ${role}`);
      expect(PHASES.some((p) => file === p || file.startsWith(`${p}-`))).toBe(true);
      expect(file.startsWith(view.phase)).toBe(true);
      expect(view.night === null).toBe(view.phase === "idle");
    }
  });

  test("there are 20-team and 30-team leaderboards", () => {
    const rows = (n: string) => (fixtures.get(n) as { standings: { rows: unknown[] } }).standings.rows.length;
    expect(rows("display/leaderboard-20")).toBe(20);
    expect(rows("display/leaderboard-30")).toBe(30);
    expect(rows("team/leaderboard-30")).toBe(30);
    expect(rows("host/leaderboard-30")).toBe(30);
  });

  test("standings use competition ranking with shared places and a tie breaker", () => {
    const rows = (fixtures.get("display/leaderboard-20") as { standings: { rows: { position: number; shared: boolean; decidedBy: string }[] } }).standings.rows;
    expect(rows.map((r) => r.position)).toEqual([...rows.map((r) => r.position)].sort((a, b) => a - b));
    expect(rows.some((r) => r.decidedBy === "tie_breaker")).toBe(true);
    const shared = rows.filter((r) => r.shared);
    expect(shared.length).toBe(2);
    expect(shared[0]!.position).toBe(shared[1]!.position);
    const after = rows[rows.indexOf(shared[1]!) + 1]!;
    expect(after.position).toBe(shared[0]!.position + 2);
  });

  test("Display fixtures never carry answers, host notes or rejoin codes (TECH-SPEC 10.3)", () => {
    for (const [name, view] of fixtures) {
      if (view.role !== "display") continue;
      const k = keys(view);
      for (const banned of ["answer", "accepted", "note", "groups", "rejoinCode", "answers", "marking"]) {
        expect(`${name} has ${banned}: ${k.has(banned)}`).toBe(`${name} has ${banned}: false`);
      }
    }
  });

  test("team fixtures never carry the correct answer or other teams' answers", () => {
    for (const [name, view] of fixtures) {
      if (view.role !== "team") continue;
      const k = keys(view);
      for (const banned of ["answer", "accepted", "note", "groups", "marking"]) {
        expect(`${name} has ${banned}: ${k.has(banned)}`).toBe(`${name} has ${banned}: false`);
      }
      const ids = new Set(view.questions.map((q) => q.id));
      for (const a of view.answers) expect(ids.has(a.questionId)).toBe(true);
    }
  });

  test("fixtures survive JSON, as they are sent over the socket", () => {
    for (const view of fixtures.values()) expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
