// @ts-check
// Marking (H-10): groups of the same normalised answer, nearest matches first, accepted
// or rejected in one tap for every team in the group. Reveal waits until nothing is pending.
import { html } from "/vendor/arrow/index.mjs";
import { acceptedList, pickMarkingQuestion, plural, sortGroups, teamNames } from "./logic.js";
import { enabled, page, send, ui } from "./state.js";

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
    <div class="q-tabs" role="tablist" aria-label="Questions to mark">${() => questions().map((m) => html`<button type="button" role="tab"
        class="${() => `q-tab${selectedId() === m.question.id ? " on" : ""}`}" aria-selected="${() => (selectedId() === m.question.id ? "true" : "false")}"
        @click="${() => { ui.markQ = m.question.id; }}">${`Q${m.question.number}`}${() => (m.pending > 0 ? html`<span class="count">${` · ${m.pending}`}</span>` : html`<span class="done-mark" aria-label="all marked"> ✓</span>`)}</button>`.key(m.question.id))}</div>
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
    ${() => (get() ? "" : html`<p class="muted">Nothing to mark yet.</p>`)}
    <p class="label">${() => { const x = get(); const r = page.view?.night?.round; return x ? (x.question.roundIndex < 0 ? `Deadlock question ${x.question.number}` : `Question ${x.question.number}${r ? ` of ${r.questionCount}` : ""}`) : ""; }}</p>
    <p class="q-text">${() => get()?.question.text || ""}</p>
    <p class="s">Accepted: <b class="accepted">${() => { const x = get(); return x ? acceptedList(x.question).join(", ") : ""; }}</b></p>
    <p class="muted s">${() => (get()?.question.answer.type === "text"
      ? "Exact matches are already marked right. Each answer below is marked once for every team that gave it. Accepting adds it to this question's accepted answers in the quiz, so it is right next time too."
      : "Marked automatically. Change a group if the quiz's answer was wrong.")}</p>
    <ul class="groups">${() => { const x = get(); return x ? sortGroups(x.groups).map((g) => groupRow(x.question.id, g.key).key(`${x.question.id}|${g.key}`)) : []; }}</ul>
    ${() => { const x = get(); return x && x.noAnswer.length ? html`<div class="group none">
        <div><p class="a">— no answer —</p><p class="who">${teamNames(/** @type {any} */ (page.view), x.noAnswer).join(", ")}</p></div>
        <span class="pill">Scores 0</span></div>` : ""; }}
  </div>`;
}

/**
 * A marking question by id, from the round's marking or from Deadlock.
 * @param {string} questionId
 * @returns {MarkingQuestion | undefined}
 */
function findMarking(questionId) {
  const v = page.view;
  if (!v) return undefined;
  const sd = v.suddenDeath && v.suddenDeath.marking;
  if (sd && sd.question.id === questionId) return sd;
  return v.marking ? v.marking.questions.find((q) => q.question.id === questionId) : undefined;
}

/**
 * One answer group. Its slots look the group up by question id and key from the view
 * only, never through the chosen tab: Arrow 1.0.6 throws if a removed row's slot is
 * queued by the same change that removes it (NOTES, "B5 host console: findings").
 * @param {string} questionId
 * @param {string} key
 */
function groupRow(questionId, key) {
  const g = () => /** @type {AnswerGroup | undefined} */ (findMarking(questionId)?.groups.find((x) => x.key === key));
  const mark = (/** @type {"correct" | "wrong"} */ value) => {
    send("mark.group", { questionId, key, mark: value });
  };
  const near = () => {
    const x = g();
    // Only a real near miss gets the hint; a distant "nearest" would mislead.
    if (!x || !x.nearest || x.nearest.similarity >= 1 || x.nearest.similarity < 0.6 || x.mark !== "pending") return "";
    return `close to "${x.nearest.accepted}"`;
  };
  return html`<li class="${() => `group ${g()?.mark || ""}`}">
    <div>
      <p class="a">${() => g()?.display || ""}</p>
      <p class="who">${() => { const x = g(); if (!x || !page.view) return ""; const n = teamNames(page.view, x.teamIds); return n.join(", ") + (n.length > 1 ? ` (${n.length} teams)` : ""); }}
        ${() => (near() ? html`<span class="near">${`· ${near()}`}</span>` : "")}</p>
    </div>
    <div class="row">
      ${() => (g()?.mark === "correct" ? html`<span class="pill ok"><i></i>Right</span>` : g()?.mark === "wrong" ? html`<span class="pill">Wrong</span>` : "")}
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
