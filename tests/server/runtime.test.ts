// SA-05: the server refuses to serve on a Bun older than MIN_BUN; engines and CI agree.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MIN_BUN, runtimeProblem, versionAtLeast } from "../../src/server/runtime.ts";

describe("runtime version (SA-05)", () => {
  test("version compare", () => {
    expect(versionAtLeast("1.4.5", "1.4.5")).toBe(true);
    expect(versionAtLeast("1.4.10", "1.4.5")).toBe(true);
    expect(versionAtLeast("1.5.0", "1.4.5")).toBe(true);
    expect(versionAtLeast("1.4.4", "1.4.5")).toBe(false);
    expect(versionAtLeast("1.3.99", "1.4.5")).toBe(false);
    expect(versionAtLeast("1.4.5-canary.1", "1.4.5")).toBe(true);
  });

  test("an old runtime is refused with a plain message; this one is fine", () => {
    expect(runtimeProblem("1.4.3")).toContain(`needs ${MIN_BUN} or later`);
    expect(runtimeProblem(Bun.version)).toBeNull();
  });

  test("package.json engines and CI ask for the same minimum", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.engines.bun).toBe(`>=${MIN_BUN} <1.5.0`);
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const pinned = /bun-version: (\S+)/.exec(ci)![1]!;
    expect(versionAtLeast(pinned, MIN_BUN)).toBe(true);
  });
});
