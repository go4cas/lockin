// @ts-check
// Round intro and asking (H-08, H-09): the host's script, the question on screen with its
// answer and note, timer controls and the answered count.
import { html } from "/vendor/arrow/index.mjs";
import { acceptedList, clockText, plural, steps, timerLeft } from "./logic.js";
import { markingPanel } from "./marking.js";
import { page } from "./state.js";
import { cmdButton, dot, pool } from "./ui.js";

/** @typedef {import("../../../src/shared/protocol").QuestionHost} QuestionHost */
/** @typedef {import("../../../src/shared/protocol").TimerView} TimerView */

/** The step pills: Q1 locked, Q2 timer running, …, Mark, Reveal, Leaderboard. */
export function stepsLine() {
  return html`<div class="steps-line" aria-label="Where the round is">${pool(() => (page.view ? steps(page.view) : []), (s) =>
    html`<span class="${() => s()?.state || ""}" hidden="${() => !s()}">${() => s()?.label || ""}</span>`)}</div>`;
}

/**
 * The question text, picture, answer and host note.
 * @param {() => QuestionHost | null | undefined} q
 */
export function questionBlock(q) {
  const alts = () => { const x = q(); return x ? acceptedList(x).slice(1) : []; };
  return html`<div class="question">
    <img class="q-img" hidden="${() => !q()?.image}" src="${() => q()?.image || ""}" alt="The question's picture">
    <p class="qbig">${() => q()?.text || ""}</p>
    <p class="ans"><span class="tick" aria-hidden="true">✓</span> Answer: <b>${() => q()?.answerText || ""}</b>
      <span class="muted s" hidden="${() => alts().length === 0}">${() => `Also accepted: ${alts().join(", ")}`}</span></p>
    <div class="card note" hidden="${() => !q()?.note}"><b>Note:</b> ${() => q()?.note || ""}</div>
  </div>`;
}

/**
 * The timer box: clock, start, pause or resume, +15 s, lock now, and the answered count.
 * @param {() => QuestionHost | null | undefined} q
 * @param {() => boolean} [perRound]
 */
export function timerBox(q, perRound = () => false) {
  const t = () => /** @type {TimerView | undefined} */ (q()?.timer);
  const clock = () => {
    const timer = t();
    if (!timer) return "";
    if (q()?.status === "locked") return "Locked";
    return clockText(timerLeft(timer, page.now));
  };
  return html`<div class="card timer-box">
    <span class="${() => `clock ${t()?.state || ""}${q()?.status === "locked" ? " locked" : ""}`}" role="timer">${clock}</span>
    <div class="timer-btns">
      ${cmdButton("timer.start", () => (perRound() ? "Start round timer" : "Start timer"), { show: () => t()?.state === "idle" && q()?.status !== "locked" })}
      ${cmdButton("timer.resume", "Resume", { show: () => t()?.state === "paused" })}
      ${cmdButton("timer.pause", "Pause", { show: () => t()?.state !== "paused" })}
      ${cmdButton("timer.add", "+15 s", { args: { seconds: 15 } })}
      ${cmdButton("lock", () => (perRound() ? "Lock the round" : "Lock now"), { cls: "danger" })}
    </div>
    <p class="answered"><b>${() => String(q()?.answered ?? 0)}</b> of ${() => String(q()?.of ?? 0)} answered
      <span class="pill ok" hidden="${() => !(q() && q()?.of && q()?.answered === q()?.of && q()?.status !== "locked")}"><i></i>Everyone has answered</span></p>
  </div>`;
}

export function roundIntroScreen() {
  const jokers = () => (page.view ? page.view.teams.filter((t) => t.jokerThisRound) : []);
  return html`<div class="stage">
    ${stepsLine()}
    <h1>${() => { const r = page.view?.night?.round; return r ? `Round ${r.index + 1}: ${r.title}` : "Next round"; }}</h1>
    <p class="muted">${() => { const r = page.view?.night?.round; return r ? `${plural(r.questionCount, "question")}${page.view?.night?.lockMode === "round" ? ", answers lock together at the end of the round" : ", each locks on its own timer"}.` : ""; }}</p>
    <section class="card">
      <h3 class="label">Jokers on this round</h3>
      <p class="muted" hidden="${() => jokers().length > 0}">${() => (page.view?.night?.joker ? "No team has played its joker on this round yet. Teams can still play it until you start the round." : "This quiz has no joker.")}</p>
      <ul class="chips" hidden="${() => jokers().length === 0}">${pool(jokers, (t) => html`<li hidden="${() => !t()}">${dot(() => t()?.colour || 1)}${() => t()?.name || ""}</li>`)}</ul>
    </section>
    ${scriptList()}
  </div>`;
}

/** The round's questions and answers, for the host to read ahead. */
function scriptList() {
  return html`<section class="card script">
    <h3 class="label">This round</h3>
    <ol class="script-list">${pool(() => (page.view?.round ? page.view.round.questions : []), (q) => html`<li class="${() => (q()?.status === "locked" ? "done" : "")}" hidden="${() => !q()}">
      <span class="q">${() => q()?.text || ""}</span> <span class="a">${() => q()?.answerText || ""}</span></li>`)}</ol>
  </section>`;
}

export function askingScreen() {
  const perRound = () => page.view?.night?.lockMode === "round";
  const current = () => page.view?.current;
  const hasMarking = () => !!(page.view?.marking && page.view.marking.questions.length);
  return html`<div class="stage">
    ${stepsLine()}
    <div class="stack" hidden="${() => !current()}">${questionBlock(current)}${timerBox(current, perRound)}</div>
    <div class="card waiting" hidden="${() => !!current()}"><p class="qbig">${() => page.view?.lines.question || "The round has started."}</p>
      <p class="muted">No question on the display yet. Press Show question 1 when the room is ready.</p></div>
    <div hidden="${() => !perRound()}">${openSoFar()}</div>
    <section class="mark-now" hidden="${() => !hasMarking()}"><h2>Mark while you wait</h2>
      <p class="muted s">Locked questions can be marked now, or all together at the end of the round.</p>
      ${markingPanel()}</section>
    <p class="muted s" hidden="${hasMarking}">${() => (perRound() ? "Every question shown so far stays open on the phones until the round locks." : "You can mark a question as soon as it locks, or mark the whole round at the end.")}</p>
  </div>`;
}

/** Per-round mode: every question shown so far, still open. */
function openSoFar() {
  return html`<section class="card script">
    <h3 class="label">Shown so far</h3>
    <ol class="script-list">${pool(() => (page.view?.round ? page.view.round.questions.slice(0, page.view.round.shown) : []), (q) => html`<li hidden="${() => !q()}">
      <span class="q">${() => q()?.text || ""}</span> <span class="a">${() => q()?.answerText || ""}</span> <span class="muted s">${() => `${q()?.answered ?? 0} of ${q()?.of ?? 0}`}</span></li>`)}</ol>
  </section>`;
}
