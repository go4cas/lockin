// @ts-check
// Sudden death, branded Deadlock (H-14): who is tied, the question and its answer,
// who has answered, marking, and who was right.
import { html } from "/vendor/arrow/index.mjs";
import { ordinal } from "./logic.js";
import { markQuestion } from "./marking.js";
import { questionBlock, timerBox } from "./asking.js";
import { page } from "./state.js";
import { dot } from "./ui.js";
import { teamById } from "./teams.js";

function sd() {
  return page.view ? page.view.suddenDeath : null;
}

export function deadlockScreen() {
  const status = () => sd()?.status || "waiting";
  return html`<div class="stage deadlock">
    <div class="card deadlock-head">
      <div>
        <p class="label">${() => `Tied for ${ordinal(sd()?.position || 1)} after the tie breaker`}</p>
        <p class="vs">${() => (sd()?.teams || []).map((t) => t.name).join(" vs ")}</p>
        ${() => ((sd()?.out || []).length ? html`<p class="muted s">${`Out: ${(sd()?.out || []).map((t) => t.name).join(", ")}`}</p>` : "")}
      </div>
      <p class="s">${() => `Question ${sd()?.questionNumber || 1} of up to ${sd()?.maxQuestions || 3}`}</p>
    </div>
    ${() => (sd()?.questionHost
      ? html`<div class="stack">${questionBlock(() => sd()?.questionHost)}
          ${() => (status() === "open" ? timerBox(() => sd()?.questionHost) : "")}</div>`
      : html`<p class="muted">No question asked yet. Ask the next Deadlock question when the room is ready.</p>`)}
    ${() => (status() === "open" || status() === "locked" ? whoAnswered() : "")}
    ${() => (sd()?.marking ? html`<section class="mark-now"><h2>Mark it</h2>${markQuestion(() => sd()?.marking)}</section>` : "")}
    ${() => (status() === "revealed" ? outcome() : "")}
    <p class="muted s">${() => `If exactly one team is right, it takes ${ordinal(sd()?.position || 1)}. If more than one is right, only the wrong teams drop out. If nobody is right, ask the next one. After ${sd()?.maxQuestions || 3} questions the teams still in it share ${ordinal(sd()?.position || 1)}.`}</p>
  </div>`;
}

function whoAnswered() {
  return html`<table class="answers-table">
    <thead><tr><th>Team</th><th>Answer</th></tr></thead>
    <tbody>${() => (sd()?.teams || []).map((t) => html`<tr>
      <td><span class="tname">${dot(() => t.colour)}${t.name}</span></td>
      <td>${() => (teamById(t.id)?.answeredCurrent ? "Answered" : html`<span class="muted">${sd()?.status === "open" ? "Waiting" : "No answer"}</span>`)}</td></tr>`.key(t.id))}</tbody>
  </table>`;
}

function outcome() {
  const right = () => new Set(sd()?.rightIds || []);
  return html`<div class="card">
    <ul class="chips">${() => (sd()?.teams || []).concat(sd()?.out || []).map((t) => html`<li class="${() => (right().has(t.id) ? "right" : "wrong")}">
      ${dot(() => t.colour)}${t.name} <b>${() => (right().has(t.id) ? "✓ right" : "wrong")}</b></li>`.key(t.id))}</ul>
    <p class="qbig">${() => {
      const o = sd()?.outcome;
      if (!o) return "Nobody settled it. Ask the next question.";
      const names = o.teamIds.map((id) => teamById(id)?.name || "A team").join(" and ");
      return o.result === "won" ? `${names} take ${ordinal(o.position)} place.` : `${names} share ${ordinal(o.position)} place.`;
    }}</p>
  </div>`;
}
