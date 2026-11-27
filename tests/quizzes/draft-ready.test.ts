// Code review LI-009: the builder's draft check (checkDraft) and readiness (validateQuiz)
// must agree on the shape and limits of a quiz file. A quiz that is ready to play must
// open and save in the builder; the only extra thing readiness asks for is completeness.
import { describe, expect, test } from "bun:test";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, QUIZ_LIMITS, validateQuiz, type QuizDraft, type QuizFile } from "../../src/shared/formats.ts";
import { newQuiz } from "../../src/server/quizzes/draft.ts";
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

describe("QuizDraft is its own type (LI-009)", () => {
  // Typechecked, never called: a draft is not a playable quiz until validateQuiz says so.
  function typesOnly(draft: QuizDraft, file: QuizFile): void {
    // @ts-expect-error a draft cannot be passed where a ready quiz is needed
    const asReady: QuizFile = draft;
    const asDraft: QuizDraft = file;   // every ready quiz is a valid draft
    const a = draft.rounds[0]!.questions[0]!.answer;
    if (a.type === "number") {
      // @ts-expect-error an unfinished number answer may be null
      const n: number = a.value;
      void n;
    }
    void asReady; void asDraft;
  }
  void typesOnly;

  test("a new quiz is a draft with empty questions, and not ready until validateQuiz passes", () => {
    const d = newQuiz("fresh", "Fresh", "2026-11-24T10:00:00.000Z");
    expect(d.rounds).toHaveLength(6);
    expect(d.rounds[0]!.questions[0]!.text).toBe("");
    expect(saves(d)).toBe(true);
    expect(ready(d)).toBe(false);
  });

  test("a new quiz takes the venue's quiz defaults when given (UI-33)", () => {
    const d = newQuiz("fresh", "Fresh", "2026-11-24T10:00:00.000Z", { rounds: 3, questionsPerRound: 8, settings: { ...DEFAULT_QUIZ_SETTINGS, timerSeconds: 30 } });
    expect(d.rounds.map((r) => r.questions.length)).toEqual([8, 8, 8]);
    expect(d.settings.timerSeconds).toBe(30);
    expect(saves(d)).toBe(true);
  });

  test("an incomplete number answer saves as null and is not ready", () => {
    const d = base(["x"]) as QuizDraft;
    d.rounds[0]!.questions[0]!.answer = { type: "number", value: null };
    const checked = checkDraft(d);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.quiz.rounds[0]!.questions[0]!.answer).toEqual({ type: "number", value: null });
    expect(ready(d)).toBe(false);
  });
});
