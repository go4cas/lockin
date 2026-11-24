// One date and year interpretation for validation and marking (code review LI-002).
import { describe, expect, test } from "bun:test";
import { validDatetime, type AnswerSpec } from "../../src/shared/formats.ts";
import { autoMark, markClosest, parseDatetime } from "../../src/server/rules/marking.ts";

type P = "year" | "date" | "time";
const spec = (precision: P, value: string, scoring: "exact" | "closest" = "exact"): AnswerSpec =>
  ({ type: "datetime", precision, value, scoring } as AnswerSpec);
const dt = (value: string) => ({ type: "datetime" as const, value });

describe("datetime: validation and marking agree (LI-002)", () => {
  const accepted: [P, string][] = [
    ["year", "-44"], ["year", "-1"], ["year", "0"], ["year", "0000"], ["year", "0001"], ["year", "0099"], ["year", "0100"], ["year", "1969"], ["year", "9999"],
    ["date", "0000-01-01"], ["date", "0001-01-01"], ["date", "0099-01-01"], ["date", "0100-03-01"], ["date", "2024-02-29"], ["date", "2000-02-29"], ["date", "1969-07-20"],
    ["time", "00:00"], ["time", "23:59"], ["time", "09:05"],
  ];
  test.each(accepted)("%s %s is valid, parses, and matches itself", (p, v) => {
    expect(validDatetime(p, v)).toBe(true);
    expect(parseDatetime(p, v)).not.toBeNull();
    expect(autoMark(spec(p, v), dt(v))).toBe("correct");
  });

  const rejected: [P, string][] = [
    ["year", "12345"], ["year", "--4"], ["year", "4-"], ["year", ""],
    ["date", "2023-02-29"], ["date", "1900-02-29"], ["date", "2024-13-01"], ["date", "2024-00-10"], ["date", "2024-04-31"],
    ["time", "24:00"], ["time", "12:60"], ["time", "1200"],
  ];
  test.each(rejected)("%s %s is invalid everywhere", (p, v) => {
    expect(validDatetime(p, v)).toBe(false);
    expect(parseDatetime(p, v)).toBeNull();
  });

  test("a negative year matches its padded and unpadded forms", () => {
    expect(autoMark(spec("year", "-44"), dt("-0044"))).toBe("correct");
    expect(autoMark(spec("year", "-44"), dt("44"))).toBe("wrong");
  });

  test("closest scoring compares signed years numerically", () => {
    const marks = markClosest(spec("year", "-44", "closest"), new Map([["a", dt("-40")], ["b", dt("44")], ["c", dt("-50")]]), "closest");
    expect(Object.fromEntries(marks)).toEqual({ a: "correct", b: "wrong", c: "wrong" });
  });

  test("date distances cross the year 100 boundary in days", () => {
    const marks = markClosest(spec("date", "0099-12-31", "closest"), new Map([["a", dt("0100-01-01")], ["b", dt("0099-12-29")]]), "closest");
    expect(Object.fromEntries(marks)).toEqual({ a: "correct", b: "wrong" });
  });
});
