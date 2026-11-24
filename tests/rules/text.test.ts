// B2: normalising, similarity and review-queue groups (TECH-SPEC 8.1, 8.2).
import { describe, expect, test } from "bun:test";
import { rules } from "../../src/server/rules/index.ts";
import { osaDistance } from "../../src/server/rules/text.ts";

describe("normalise (8.1)", () => {
  const cases: [string, string, string][] = [
    ["J.F.K. vs jfk", "J.F.K.", "jfk"],
    ["jfk unchanged", "jfk", "jfk"],
    ["leading The", "The Beatles", "beatles"],
    ["leading A", "A Tribe Called Quest", "tribe called quest"],
    ["leading An", "An Officer and a Gentleman", "officer and a gentleman"],
    ["only one article removed", "The The", "the"],
    ["article not at start kept", "Pink Floyd the band", "pink floyd the band"],
    ["article needs a following word", "the", "the"],
    ["word starting like an article kept", "Theremin", "theremin"],
    ["accents dropped", "Beyoncé Knowles", "beyonce knowles"],
    ["more accents", "Motörhead Ça Ñandú", "motorhead ca nandu"],
    ["compatibility forms (NFKD)", "ﬁve ２", "five 2"],
    ["& becomes and", "Simon & Garfunkel", "simon and garfunkel"],
    ["& without spaces", "AT&T", "atandt"],
    ["punctuation dropped", "Rock 'n' Roll!", "rock n roll"],
    ["hyphen dropped, words joined", "Spider-Man", "spiderman"],
    ["spaces collapsed and trimmed", "  John   F   Kennedy  ", "john f kennedy"],
    ["tabs and newlines count as spaces", "John\tF\nKennedy", "john f kennedy"],
    ["article after trimming and punctuation", "  ...the Who?", "who"],
    ["digits kept", "Apollo 11", "apollo 11"],
    ["non-Latin letters kept", "Москва", "москва"],
    ["only punctuation is empty", "?!...", ""],
    ["empty", "", ""],
  ];
  test.each(cases)("%s", (_name, input, expected) => {
    expect(rules.normalise(input)).toBe(expected);
  });

  test("J.F.K. and jfk normalise to the same key", () => {
    expect(rules.normalise("J.F.K.")).toBe(rules.normalise("jfk"));
  });
});

describe("similarity (8.2)", () => {
  test.each([
    ["identical", "beatles", "beatles", 1],
    ["equal after normalising", "The Beatles!", "beatles", 1],
    ["both empty", "", "", 1],
    ["one empty", "", "abc", 0],
    ["one substitution in 4", "abcd", "abxd", 0.75],
    ["transposition counts as one edit (OSA)", "abcd", "abdc", 0.75],
    ["completely different", "abc", "xyz", 0],
  ] as [string, string, string, number][])("%s", (_name, a, b, expected) => {
    expect(rules.similarity(a, b)).toBeCloseTo(expected, 10);
  });

  test("is symmetric and between 0 and 1", () => {
    for (const [a, b] of [["kennedy", "kenedy"], ["paris", "pairs"], ["x", "a long answer"]] as const) {
      const s = rules.similarity(a, b);
      expect(s).toBe(rules.similarity(b, a));
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  test("ordering: closer typos score higher", () => {
    const target = "John F Kennedy";
    const answers = ["John F Kennedy", "John F Kenedy", "Jon F Kenedy", "JFK", "Nixon"];
    const scores = answers.map((a) => rules.similarity(a, target));
    const sorted = [...scores].sort((x, y) => y - x);
    expect(scores).toEqual(sorted);
    expect(new Set(scores).size).toBe(scores.length);
  });

  test("OSA distance: transposition is 1, not 2; OSA does not edit a substring twice", () => {
    expect(osaDistance("ab", "ba")).toBe(1);
    expect(osaDistance("ca", "abc")).toBe(3); // full Damerau-Levenshtein gives 2
    expect(osaDistance("kitten", "sitting")).toBe(3);
    expect(osaDistance("", "abc")).toBe(3);
  });
});

describe("groupText (8.2)", () => {
  const spec = { type: "text" as const, accepted: ["John F Kennedy", "Kennedy"] };

  test("groups by normalised answer; display is the first raw answer received", () => {
    const groups = rules.groupText(spec, [
      { teamId: "t1", text: "JFK", mark: "pending" },
      { teamId: "t2", text: "J.F.K.", mark: "pending" },
      { teamId: "t3", text: "jfk", mark: "pending" },
      { teamId: "t4", text: "Nixon", mark: "pending" },
    ]);
    const jfk = groups.find((g) => g.key === "jfk")!;
    expect(jfk.display).toBe("JFK");
    expect(jfk.teamIds).toEqual(["t1", "t2", "t3"]);
    expect(jfk.mark).toBe("pending");
    expect(groups).toHaveLength(2);
  });

  test("nearest matches come first, with the nearest accepted answer", () => {
    const groups = rules.groupText(spec, [
      { teamId: "t1", text: "Nixon", mark: "pending" },
      { teamId: "t2", text: "Kenedy", mark: "pending" },
      { teamId: "t3", text: "John Kennedy", mark: "pending" },
    ]);
    expect(groups.map((g) => g.display)).toEqual(["Kenedy", "John Kennedy", "Nixon"]);
    expect(groups[0]!.nearest).toEqual({ accepted: "Kennedy", similarity: rules.similarity("kenedy", "Kennedy") });
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1]!.nearest!.similarity).toBeGreaterThanOrEqual(groups[i]!.nearest!.similarity);
    }
  });

  test("equal similarity keeps the order received", () => {
    const groups = rules.groupText({ type: "text", accepted: ["abcd"] }, [
      { teamId: "t1", text: "abxd", mark: "pending" },
      { teamId: "t2", text: "abcx", mark: "pending" },
      { teamId: "t3", text: "xbcd", mark: "pending" },
    ]);
    expect(groups.map((g) => g.display)).toEqual(["abxd", "abcx", "xbcd"]);
  });

  test("group mark is shared when every team agrees, pending when they differ", () => {
    const groups = rules.groupText(spec, [
      { teamId: "t1", text: "Kennedy", mark: "correct" },
      { teamId: "t2", text: "kennedy", mark: "correct" },
      { teamId: "t3", text: "Lincoln", mark: "wrong" },
      { teamId: "t4", text: "Nixon", mark: "wrong" },
      { teamId: "t5", text: "nixon", mark: "pending" },
    ]);
    const by = Object.fromEntries(groups.map((g) => [g.key, g.mark]));
    expect(by).toEqual({ kennedy: "correct", lincoln: "wrong", nixon: "pending" });
  });

  test("a team is listed once even if it appears twice", () => {
    const groups = rules.groupText(spec, [
      { teamId: "t1", text: "Nixon", mark: "pending" },
      { teamId: "t1", text: "nixon", mark: "pending" },
    ]);
    expect(groups[0]!.teamIds).toEqual(["t1"]);
  });

  test("no accepted answers: nearest is null", () => {
    const groups = rules.groupText({ type: "text", accepted: [] }, [{ teamId: "t1", text: "x", mark: "pending" }]);
    expect(groups[0]!.nearest).toBeNull();
  });

  test("no answers: no groups", () => {
    expect(rules.groupText(spec, [])).toEqual([]);
  });
});
