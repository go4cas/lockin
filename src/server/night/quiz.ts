// Helpers over a quiz snapshot: finding questions, input shapes and answer text.

import type { AnswerSpec, Question, QuizFile } from "../../shared/formats.ts";
import type { QuestionPublic } from "../../shared/protocol.ts";
import type { AnswerValue } from "../../shared/rules-api.ts";

export interface QuestionRef {
  q: Question;
  round: number;      // -1 for sudden death
  index: number;      // 0-based within the round or the sudden-death list
}

export function indexQuestions(quiz: QuizFile): Map<string, QuestionRef> {
  const map = new Map<string, QuestionRef>();
  quiz.rounds.forEach((r, ri) => r.questions.forEach((q, i) => map.set(q.id, { q, round: ri, index: i })));
  quiz.suddenDeath.forEach((q, i) => map.set(q.id, { q, round: -1, index: i }));
  return map;
}

/** 0-based index of the halftime round, or null (QuizSettings.halftimeAfterRound). The last round never has a halftime after it. */
export function halftimeRound(quiz: QuizFile): number | null {
  const h = quiz.settings.halftimeAfterRound;
  const n = quiz.rounds.length;
  const after = h === "none" ? null : h === "auto" ? Math.ceil(n / 2) : h;
  if (after === null || after < 1 || after >= n) return null;
  return after - 1;
}

export function inputOf(spec: AnswerSpec): QuestionPublic["input"] {
  switch (spec.type) {
    case "text": return { type: "text" };
    case "choice": return { type: "choice", options: [...spec.options] };
    case "number":
    case "closest": return { type: "number" };
    case "datetime": return { type: "datetime", precision: spec.precision };
  }
}

const letter = (i: number) => String.fromCharCode(65 + i);

/** The answer shown at reveal (10.3 RevealItem.answerText). */
export function answerText(spec: AnswerSpec): string {
  switch (spec.type) {
    case "text": return spec.accepted[0] ?? "";
    case "choice": return `${letter(spec.correct)}. ${spec.options[spec.correct] ?? ""}`;
    case "number":
    case "closest": return String(spec.value);
    case "datetime": return spec.value;
  }
}

/** How a team's answer reads on the console and in history. */
export function valueText(value: AnswerValue, spec: AnswerSpec): string {
  switch (value.type) {
    case "text": return value.text;
    case "choice": return spec.type === "choice" ? `${letter(value.index)}. ${spec.options[value.index] ?? ""}` : String(value.index);
    case "number": return String(value.value);
    case "datetime": return value.value;
  }
}

/** Group key for answers that are not typed text: one group per distinct value (10.3 MarkingQuestion). */
export function valueKey(value: AnswerValue): string {
  switch (value.type) {
    case "text": return `text:${value.text}`;
    case "choice": return `choice:${value.index}`;
    case "number": return `number:${value.value}`;
    case "datetime": return `datetime:${value.value}`;
  }
}

/** True when the question is marked by markClosest at the lock (8.2). */
export function isClosest(spec: AnswerSpec): boolean {
  return spec.type === "closest" || (spec.type === "datetime" && spec.scoring === "closest");
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function timerSecondsOf(quiz: QuizFile, q: Question): number {
  return q.timerSeconds ?? quiz.settings.timerSeconds;
}
