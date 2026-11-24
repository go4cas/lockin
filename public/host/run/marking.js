// @ts-check
// Marking (H-10): groups of the same normalised answer, nearest matches first, accepted
// or rejected in one tap for every team in the group. Reveal waits until nothing is pending.
import { html } from "/vendor/arrow/index.mjs";
import { acceptedList, pickMarkingQuestion, plural, sortGroups, teamNames } from "./logic.js";
import { enabled, page, send, ui } from "./state.js";
import { pool } from "./ui.js";

/** @typedef {import("../../../src/shared/protocol").MarkingQuestion} MarkingQuestion */
/** @typedef {import("../../../src/shared/rules-api").AnswerGroup} AnswerGroup */

function questions() {
  return page.view && page.view.marking ? page.view.marking.questions : [];
}

function selectedId() {
  return pickMarkingQuestion(questions(), ui.markQ || null);
}

/** @returns {MarkingQuestion | undefined} */
function selected() {
  const id = selectedId();
  return questions().find((q) => q.question.id === id);
}

/** Tabs for the locked questions, with how many answers each still needs, and the groups of the chosen one. */
export function markingPanel() {
  return html`<div class="marking">
    <div class="q-tabs" role="tablist" aria-label="Questions to mark">${pool(questions, (m) => html`<button type="button" role="tab" hidden="${() => !m()}"
        class="${() => `q-tab${m() && selectedId() === m()?.question.id ? " on" : ""}`}" aria-selected="${() => (m() && selectedId() === m()?.question.id ? "true" : "false")}"
        @click="${() => { const x = m(); if (x) ui.markQ = x.question.id; }}">${() => `Q${m()?.question.number ?? ""}`}<span class="count" hidden="${() => !((m()?.pending ?? 0) > 0)}">${() => ` · ${m()?.pending ?? 0}`}</span><span class="done-mark" aria-label="all marked" hidden="${() => (m()?.pending ?? 0) > 0}"> ✓</span></button>`)}</div>
    ${markQuestion(selected)}
  </div>`;
}

/**
 * One question's answer groups.
 * @param {() => MarkingQuestion | null | undefined} get
 */
export function markQuestion(get) {
  // Built once; only the slots inside follow the chosen question, so switching
  // questions never rebuilds this block (see NOTES: Arrow and rebuilt slots).
  return html`<div class="mark-q">
    <p class="muted" hidden="${() => !!get()}">Nothing to mark yet.</p>
    <p class="label">${() => { const x = get(); const r = page.view?.night?.round; return x ? (x.question.roundIndex < 0 ? `Deadlock question ${x.question.number}` : `Question ${x.question.number}${r ? ` of ${r.questionCount}` : ""}`) : ""; }}</p>
    <p class="q-text">${() => get()?.question.text || ""}</p>
    <p class="s">Accepted: <b class="accepted">${() => { const x = get(); return x ? acceptedList(x.question).join(", ") : ""; }}</b></p>
    <p class="muted s">${() => (get()?.question.answer.type === "text"
      ? "Exact matches are already marked right. Each answer below is marked once for every team that gave it. Accepting adds it to this question's accepted answers in the quiz, so it is right next time too."
      : "Marked automatically. Change a group if the quiz's answer was wrong.")}</p>
    <ul class="groups">${pool(() => { const x = get(); return x ? sortGroups(x.groups) : []; }, (g) => groupRow(() => get()?.question.id || "", g))}</ul>
    <div class="group none" hidden="${() => !get()?.noAnswer.length}">
      <div><p class="a">— no answer —</p><p class="who">${() => { const x = get(); return x && page.view ? teamNames(page.view, x.noAnswer).join(", ") : ""; }}</p></div>
      <span class="pill">Scores 0</span></div>
  </div>`;
}

/**
 * One answer group: row i of the pool shows the chosen question's group i.
 * @param {() => string} questionId
 * @param {() => AnswerGroup | undefined} g
 */
function groupRow(questionId, g) {
  const mark = (/** @type {"correct" | "wrong"} */ value) => {
    const x = g();
    if (x) send("mark.group", { questionId: questionId(), key: x.key, mark: value });
  };
  const near = () => {
    const x = g();
    // Only a real near miss gets the hint; a distant "nearest" would mislead.
    if (!x || !x.nearest || x.nearest.similarity >= 1 || x.nearest.similarity < 0.6 || x.mark !== "pending") return "";
    return `close to "${x.nearest.accepted}"`;
  };
  return html`<li class="${() => `group ${g()?.mark || ""}`}" hidden="${() => !g()}">
    <div>
      <p class="a">${() => g()?.display || ""}</p>
      <p class="who">${() => { const x = g(); if (!x || !page.view) return ""; const n = teamNames(page.view, x.teamIds); return n.join(", ") + (n.length > 1 ? ` (${n.length} teams)` : ""); }}
        <span class="near" hidden="${() => !near()}">${() => `· ${near()}`}</span></p>
    </div>
    <div class="row">
      <span class="pill ok" hidden="${() => g()?.mark !== "correct"}"><i></i>Right</span><span class="pill" hidden="${() => g()?.mark !== "wrong"}">Wrong</span>
      <button type="button" class="${() => `btn ${g()?.mark === "wrong" ? "ghost" : "ok"}`}" aria-pressed="${() => (g()?.mark === "correct" ? "true" : "false")}"
        disabled="${() => !enabled("mark.group")}" @click="${() => mark("correct")}">✓ Accept</button>
      <button type="button" class="${() => `btn ${g()?.mark === "wrong" ? "on-wrong" : "ghost"}`}" aria-pressed="${() => (g()?.mark === "wrong" ? "true" : "false")}"
        disabled="${() => !enabled("mark.group")}" @click="${() => mark("wrong")}">✕ Reject</button>
    </div>
  </li>`;
}

export function markingScreen() {
  return html`<div class="stage">${markingPanel()}</div>`;
}

/** The side panel's note under the reveal button. */
export function pendingNote() {
  const left = page.view && page.view.marking ? page.view.marking.pendingTotal : 0;
  return left ? `${plural(left, "answer")} left to mark` : "Everything is marked.";
}
