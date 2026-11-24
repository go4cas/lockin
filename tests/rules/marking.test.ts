// B2: auto-marking and closest scoring (TECH-SPEC 8.2).
import { describe, expect, test } from "bun:test";
import type { AnswerSpec } from "../../src/shared/formats.ts";
import type { AnswerValue, Mark } from "../../src/shared/rules-api.ts";
import { rules } from "../../src/server/rules/index.ts";

const text = (t: string): AnswerValue => ({ type: "text", text: t });
const choice = (i: number): AnswerValue => ({ type: "choice", index: i });
const num = (v: number): AnswerValue => ({ type: "number", value: v });
const dt = (v: string): AnswerValue => ({ type: "datetime", value: v });
const NO_ANSWER = undefined as unknown as AnswerValue;

const TEXT: AnswerSpec = { type: "text", accepted: ["John F Kennedy", "JFK"] };
const CHOICE: AnswerSpec = { type: "choice", options: ["a", "b", "c"], correct: 1 };
const NUMBER: AnswerSpec = { type: "number", value: 42 };
const YEAR: AnswerSpec = { type: "datetime", precision: "year", value: "1969", scoring: "exact" };
const DATE: AnswerSpec = { type: "datetime", precision: "date", value: "1969-07-20", scoring: "exact" };
const TIME: AnswerSpec = { type: "datetime", precision: "time", value: "20:17", scoring: "exact" };
const CLOSEST: AnswerSpec = { type: "closest", value: 100, range: 5 };
const DATE_CLOSEST: AnswerSpec = { type: "datetime", precision: "date", value: "1969-07-20", scoring: "closest", range: 3 };

describe("autoMark: every row in 8.2", () => {
  const cases: [string, AnswerSpec, AnswerValue, Mark][] = [
    // text
    ["text: exact accepted answer", TEXT, text("John F Kennedy"), "correct"],
    ["text: matches after normalising", TEXT, text("  john f. KENNEDY "), "correct"],
    ["text: J.F.K. matches accepted JFK", TEXT, text("J.F.K."), "correct"],
    ["text: second accepted answer", TEXT, text("jfk"), "correct"],
    ["text: close but not equal stays pending", TEXT, text("John F Kenedy"), "pending"],
    ["text: clearly wrong still pending (never auto-wrong)", TEXT, text("Nixon"), "pending"],
    ["text: only punctuation is pending, never matched", TEXT, text("???"), "pending"],
    ["text: wrong value type is wrong", TEXT, num(1), "wrong"],
    // choice
    ["choice: right index", CHOICE, choice(1), "correct"],
    ["choice: wrong index", CHOICE, choice(0), "wrong"],
    ["choice: out of range", CHOICE, choice(9), "wrong"],
    // number
    ["number: exact", NUMBER, num(42), "correct"],
    ["number: within 1e-9", NUMBER, num(42 + 1e-10), "correct"],
    ["number: float sum equals", { type: "number", value: 0.3 }, num(0.1 + 0.2), "correct"],
    ["number: off by 1e-6", NUMBER, num(42.000001), "wrong"],
    ["number: off by one", NUMBER, num(41), "wrong"],
    ["number: NaN", NUMBER, num(Number.NaN), "wrong"],
    // datetime exact, each precision
    ["year: equal", YEAR, dt("1969"), "correct"],
    ["year: spaces trimmed", YEAR, dt(" 1969 "), "correct"],
    ["year: off by one", YEAR, dt("1970"), "wrong"],
    ["year: not a year", YEAR, dt("sixty-nine"), "wrong"],
    ["year: short year padded both sides", { type: "datetime", precision: "year", value: "0800", scoring: "exact" }, dt("800"), "correct"],
    ["date: equal", DATE, dt("1969-07-20"), "correct"],
    ["date: single-digit month and day", DATE, dt("1969-7-20"), "correct"],
    ["date: day off", DATE, dt("1969-07-21"), "wrong"],
    ["date: impossible date", { type: "datetime", precision: "date", value: "2001-02-28", scoring: "exact" }, dt("2001-02-29"), "wrong"],
    ["date: leap day", { type: "datetime", precision: "date", value: "2000-02-29", scoring: "exact" }, dt("2000-02-29"), "correct"],
    ["date: year only at date precision", DATE, dt("1969"), "wrong"],
    ["time: equal", TIME, dt("20:17"), "correct"],
    ["time: single-digit hour", { type: "datetime", precision: "time", value: "09:05", scoring: "exact" }, dt("9:05"), "correct"],
    ["time: seconds dropped", TIME, dt("20:17:45"), "correct"],
    ["time: minute off", TIME, dt("20:18"), "wrong"],
    ["time: out of range", TIME, dt("24:17"), "wrong"],
    // closest types wait for markClosest
    ["closest: pending until markClosest", CLOSEST, num(100), "pending"],
    ["datetime closest: pending until markClosest", DATE_CLOSEST, dt("1969-07-20"), "pending"],
    // no answer
    ["no answer: text", TEXT, NO_ANSWER, "wrong"],
    ["no answer: choice", CHOICE, NO_ANSWER, "wrong"],
    ["no answer: number", NUMBER, NO_ANSWER, "wrong"],
    ["no answer: datetime", DATE, NO_ANSWER, "wrong"],
    ["wrong type: choice given a number", CHOICE, num(1), "wrong"],
    ["wrong type: date given a number", DATE, num(1969), "wrong"],
  ];
  test.each(cases)("%s", (_name, spec, value, expected) => {
    expect(rules.autoMark(spec, value)).toBe(expected);
  });
});

function marks(spec: AnswerSpec, answers: Record<string, AnswerValue | null>, scoring: "closest" | "range") {
  const values = new Map(Object.entries(answers)) as Map<string, AnswerValue>;
  return Object.fromEntries(rules.markClosest(spec, values, scoring));
}

describe("markClosest: closest scoring", () => {
  test("only the closest team is correct", () => {
    expect(marks(CLOSEST, { a: num(90), b: num(103), c: num(150) }, "closest")).toEqual({ a: "wrong", b: "correct", c: "wrong" });
  });
  test("teams sharing the closest distance all score (either side)", () => {
    expect(marks(CLOSEST, { a: num(97), b: num(103), c: num(110) }, "closest")).toEqual({ a: "correct", b: "correct", c: "wrong" });
  });
  test("an exact answer is closest", () => {
    expect(marks(CLOSEST, { a: num(100), b: num(101) }, "closest")).toEqual({ a: "correct", b: "wrong" });
  });
  test("decimals tie despite float error", () => {
    const spec: AnswerSpec = { type: "closest", value: 0.3 };
    expect(marks(spec, { a: num(0.1 + 0.2 + 0.1), b: num(0.2) }, "closest")).toEqual({ a: "correct", b: "correct" });
  });
  test("missing answers are wrong and do not count as closest", () => {
    expect(marks(CLOSEST, { a: null, b: num(500), c: { type: "text", text: "100" } }, "closest")).toEqual({ a: "wrong", b: "correct", c: "wrong" });
  });
  test("nobody answered: everyone in the map is wrong", () => {
    expect(marks(CLOSEST, { a: null, b: null }, "closest")).toEqual({ a: "wrong", b: "wrong" });
  });
  test("no teams: empty result", () => {
    expect(marks(CLOSEST, {}, "closest")).toEqual({});
  });
  test("one team answered: it is closest", () => {
    expect(marks(CLOSEST, { a: num(1e6) }, "closest")).toEqual({ a: "correct" });
  });
});

describe("markClosest: range scoring", () => {
  test("every team within the range scores, boundary included", () => {
    expect(marks(CLOSEST, { a: num(95), b: num(105), c: num(94), d: num(100), e: num(106) }, "range"))
      .toEqual({ a: "correct", b: "correct", c: "wrong", d: "correct", e: "wrong" });
  });
  test("nobody within range: everyone wrong", () => {
    expect(marks(CLOSEST, { a: num(50), b: num(200) }, "range")).toEqual({ a: "wrong", b: "wrong" });
  });
  test("missing range counts as 0: only exact answers score", () => {
    const spec: AnswerSpec = { type: "closest", value: 100 };
    expect(marks(spec, { a: num(100), b: num(101) }, "range")).toEqual({ a: "correct", b: "wrong" });
  });
  test("missing answers are wrong", () => {
    expect(marks(CLOSEST, { a: null, b: num(100) }, "range")).toEqual({ a: "wrong", b: "correct" });
  });
});

describe("markClosest: datetime precisions", () => {
  test("year: distance in years", () => {
    const spec: AnswerSpec = { type: "datetime", precision: "year", value: "1969", scoring: "closest", range: 1 };
    expect(marks(spec, { a: dt("1966"), b: dt("1971"), c: dt("1972") }, "closest")).toEqual({ a: "wrong", b: "correct", c: "wrong" });
    expect(marks(spec, { a: dt("1968"), b: dt("1970"), c: dt("1971") }, "range")).toEqual({ a: "correct", b: "correct", c: "wrong" });
  });
  test("date: distance in days, across months and a leap year", () => {
    const spec: AnswerSpec = { type: "datetime", precision: "date", value: "2000-03-01", scoring: "closest", range: 1 };
    // 2000-02-29 is 1 day before; 2000-03-03 is 2 days after.
    expect(marks(spec, { a: dt("2000-02-29"), b: dt("2000-03-03") }, "closest")).toEqual({ a: "correct", b: "wrong" });
    expect(marks(spec, { a: dt("2000-02-29"), b: dt("2000-03-02"), c: dt("2000-02-28") }, "range")).toEqual({ a: "correct", b: "correct", c: "wrong" });
  });
  test("date: a far date is far (not compared as text)", () => {
    expect(marks(DATE_CLOSEST, { a: dt("1969-08-19"), b: dt("1970-07-20") }, "closest")).toEqual({ a: "correct", b: "wrong" });
  });
  test("time: distance in minutes, across the hour", () => {
    const spec: AnswerSpec = { type: "datetime", precision: "time", value: "20:17", scoring: "closest", range: 15 };
    expect(marks(spec, { a: dt("19:59"), b: dt("20:30"), c: dt("21:00") }, "closest")).toEqual({ a: "wrong", b: "correct", c: "wrong" });
    expect(marks(spec, { a: dt("20:02"), b: dt("20:32"), c: dt("20:01") }, "range")).toEqual({ a: "correct", b: "correct", c: "wrong" });
  });
  test("invalid datetime answers are wrong", () => {
    expect(marks(DATE_CLOSEST, { a: dt("1969-02-30"), b: dt("2020-01-01") }, "closest")).toEqual({ a: "wrong", b: "correct" });
  });
});

describe("markClosest on a spec not scored by closeness", () => {
  test("auto-marks each value", () => {
    expect(marks(CHOICE, { a: choice(1), b: choice(2), c: null }, "closest")).toEqual({ a: "correct", b: "wrong", c: "wrong" });
  });
});
