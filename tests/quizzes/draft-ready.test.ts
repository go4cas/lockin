// Code review LI-009: the builder's draft check (checkDraft) and readiness (validateQuiz)
// must agree on the shape and limits of a quiz file. A quiz that is ready to play must
// open and save in the builder; the only extra thing readiness asks for is completeness.
import { describe, expect, test } from "bun:test";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, QUIZ_LIMITS, validateQuiz, type QuizFile } from "../../src/shared/formats.ts";
import { checkDraft } from "../../src/server/quizzes/draft.ts";

const base = (accepted: string[]): QuizFile => ({
  format: QUIZ_FORMAT, id: "limits", title: "Limits", updatedAt: "2026-11-24T10:00:00.000Z",
  settings: { ...DEFAULT_QUIZ_SETTINGS },
  rounds: [{ id: "r-aaaaaaaa", title: "One", questions: [
    { id: "q-aaaaaaaa", text: "Name a colour", answer: { type: "text", accepted } },
  ] }],
  suddenDeath: [],
});
const answers = (n: number) => Array.from({ length: n }, (_, i) => `answer ${i + 1}`);
const ready = (q: unknown) => validateQuiz(q).ok;
const saves = (q: unknown) => checkDraft(q).ok;

describe("draft and ready agree on accepted answers", () => {
  test("the limit is 50", () => {
    expect(QUIZ_LIMITS.accepted).toBe(50);
  });
  for (const n of [1, 50]) {
    test(`${n} accepted: ready and saves`, () => {
      expect(ready(base(answers(n)))).toBe(true);
      expect(saves(base(answers(n)))).toBe(true);
    });
  }
  test("51 accepted: neither (before, ready to play but the builder refused it)", () => {
    const r = validateQuiz(base(answers(51)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]!.message).toContain("more than 50 accepted answers");
    expect(saves(base(answers(51)))).toBe(false);
  });
  test("0 accepted: saves as a draft, not ready", () => {
    expect(saves(base([]))).toBe(true);
    expect(ready(base([]))).toBe(false);
  });
});

describe("every ready quiz can be saved by the builder", () => {
  const full: QuizFile = {
    ...base(["Red", "Scarlet"]),
    settings: { lockMode: "round", timerSeconds: 300, halftimeAfterRound: 1, joker: false, maxTeams: 30, suddenDeathScope: "all", suddenDeathMax: 10, closestScoring: "range" },
    rounds: [{ id: "r-bbbbbbbb", title: "x".repeat(QUIZ_LIMITS.roundTitleChars), questions: [
      { id: "q-bbbbbbb1", text: "t".repeat(QUIZ_LIMITS.textChars), note: "n".repeat(300), timerSeconds: 10, answer: { type: "choice", options: answers(6), correct: 5 } },
      { id: "q-bbbbbbb2", text: "How many?", answer: { type: "number", value: -1.5 } },
      { id: "q-bbbbbbb3", text: "Closest?", answer: { type: "closest", value: 8849, range: 0 } },
      { id: "q-bbbbbbb4", text: "When?", answer: { type: "datetime", precision: "time", value: "20:17", scoring: "closest", range: 5 } },
      { id: "q-bbbbbbb5", text: "Picture", media: { kind: "image", file: "a-b_c.d.png", alt: "a" }, answer: { type: "text", accepted: answers(50) } },
    ] }],
    suddenDeath: [{ id: "q-sdsdsdsd", text: "Closest?", answer: { type: "closest", value: 1 } }],
  };
  test("a quiz at the edges of every limit is ready and saves", () => {
    const r = validateQuiz(full);
    expect(r.ok ? [] : r.problems).toEqual([]);
    const d = checkDraft(full);
    expect(d.ok ? [] : d.problems).toEqual([]);
  });

  const settingsCases: [string, unknown][] = [
    ["timerSeconds", 9], ["timerSeconds", 301], ["timerSeconds", 10.5], ["maxTeams", 1], ["maxTeams", 31],
    ["halftimeAfterRound", 0], ["halftimeAfterRound", 21], ["halftimeAfterRound", "later"], ["suddenDeathMax", 0], ["suddenDeathMax", 11],
    ["lockMode", "team"], ["joker", "yes"], ["suddenDeathScope", "last"], ["closestScoring", "nearest"],
  ];
  for (const [k, v] of settingsCases) {
    test(`settings.${k} = ${JSON.stringify(v)} is refused by both`, () => {
      const q = { ...base(["Red"]), settings: { ...DEFAULT_QUIZ_SETTINGS, [k]: v } };
      expect(ready(q)).toBe(false);
      expect(saves(q)).toBe(false);
    });
  }
  for (const [k, v] of [["timerSeconds", 10], ["timerSeconds", 300], ["maxTeams", 2], ["maxTeams", 30], ["suddenDeathMax", 1], ["halftimeAfterRound", "none"]] as [string, unknown][]) {
    test(`settings.${k} = ${JSON.stringify(v)} is accepted by both`, () => {
      const q = { ...base(["Red"]), settings: { ...DEFAULT_QUIZ_SETTINGS, [k]: v } };
      expect(ready(q)).toBe(true);
      expect(saves(q)).toBe(true);
    });
  }

  test("drafts may be incomplete: empty text, incomplete choice, unknown kinds", () => {
    const draft = {
      ...base([""]),
      rounds: [{ id: "r-cccccccc", title: "", questions: [
        { id: "q-ccccccc1", text: "", answer: { type: "text", accepted: [""] } },
        { id: "q-ccccccc2", text: "Pick", answer: { type: "choice", options: ["A"], correct: -1 } },
        { id: "q-ccccccc3", text: "How many?", answer: { type: "number", value: null } },
        { id: "q-ccccccc4", text: "Listen", media: { kind: "audio", file: "a.mp3" }, answer: { type: "music", any: 1 } },
      ] }],
    };
    expect(saves(draft)).toBe(true);
    const r = validateQuiz(draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.path)).toEqual([
      "rounds.0.questions.0.text", "rounds.0.questions.0.answer.accepted",
      "rounds.0.questions.1.answer.options", "rounds.0.questions.2.answer.value",
      "rounds.0.questions.3.media.kind", "rounds.0.questions.3.answer.type",
    ]);
  });
});
