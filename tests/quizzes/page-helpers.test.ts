// B3 browser helpers that have no DOM: readiness labels, problem grouping, image sizing.
import { describe, expect, test } from "bun:test";
import { groupProblems, readinessLabel } from "../../public/host/build/api.js";
import { fitSize } from "../../public/host/build/image.js";

describe("readinessLabel", () => {
  test("ready, question problems, other problems", () => {
    expect(readinessLabel(true, [])).toBe("Ready");
    const q = (path: string) => ({ path, message: "x" });
    expect(readinessLabel(false, [q("rounds.0.questions.0.text"), q("rounds.0.questions.0.answer"), q("suddenDeath.1.answer")])).toBe("2 questions need work");
    expect(readinessLabel(false, [q("rounds.0.questions.3.answer")])).toBe("1 question needs work");
    expect(readinessLabel(false, [q("format")])).toBe("1 thing to fix");
    expect(readinessLabel(false, [q("rounds.2.questions"), q("rounds.0.questions.0.text")])).toBe("2 things to fix");
  });
});

describe("groupProblems", () => {
  test("a question with no text and no answer becomes one 'still empty' line", () => {
    expect(groupProblems([
      { path: "rounds.0.questions.0.text", message: "Round 1, question 1 has no question text." },
      { path: "rounds.0.questions.0.answer", message: "Round 1, question 1 has no answer." },
      { path: "rounds.0.questions.1.answer", message: "Round 1, question 2 has no answer." },
      { path: "rounds.0.questions.2.text", message: "Round 1, question 3 has no question text." },
    ])).toEqual([
      { path: "rounds.0.questions.0.text", message: "Round 1, question 1 is still empty." },
      { path: "rounds.0.questions.1.answer", message: "Round 1, question 2 has no answer." },
      { path: "rounds.0.questions.2.text", message: "Round 1, question 3 has no question text." },
    ]);
  });
});

describe("fitSize (H-03: at most 1920 x 1080, never upscaled)", () => {
  test("sizes", () => {
    expect(fitSize(4000, 3000)).toEqual({ w: 1440, h: 1080 });
    expect(fitSize(3840, 1080)).toEqual({ w: 1920, h: 540 });
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitSize(1080, 1920)).toEqual({ w: 608, h: 1080 });
  });
});
