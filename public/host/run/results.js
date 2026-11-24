// @ts-check
// Reveal, leaderboard, halftime and Quiz End (H-11, H-12, H-07), and changing a mark
// from the standings (H-13). Earlier rounds' marks come from GET /api/history/:nightId,
// which also answers for the open night (TECH-SPEC 9.2, agreed with Cas 2026-11-24).
import { html, reactive } from "/vendor/arrow/index.mjs";
import { ordinal, plural } from "./logic.js";
import { stepsLine } from "./asking.js";
import { enabled, getJson, openDialog, page, send, ui } from "./state.js";
import { dialogFrame, dot } from "./ui.js";

/** @typedef {import("../../../src/shared/protocol").HistoryDetail} HistoryDetail */

// ---- Night detail from the history API --------------------------------------

export const hist = reactive({
  nightId: "",
  loading: false,
  problem: "",
  /** @type {HistoryDetail | null} */ detail: /** @type {any} */ (null),
});

/** Loads (or reloads) the open night's questions, answers and marks. */
export async function loadDetail() {
  const night = page.view && page.view.night;
  if (!night) return;
  hist.loading = true;
  hist.problem = "";
  try {
    const d = await getJson(`/api/history/${encodeURIComponent(night.id)}`);
    if (!d || !Array.isArray(d.rounds) || !Array.isArray(d.answers)) throw new Error("The night's marks came back in a shape this console does not know.");
    hist.detail = d;
    hist.nightId = night.id;
  } catch (e) {
    hist.problem = /** @type {Error} */ (e).message;
  } finally {
    hist.loading = false;
  }
}

/**
 * The answer and mark one team has on one question, if known.
 * @param {string} teamId
 * @param {string} questionId
 */
function answerOf(teamId, questionId) {
  const d = hist.detail;
  return d ? d.answers.find((a) => a.teamId === teamId && a.questionId === questionId) : undefined;
}

/**
 * Sets one team's mark on one question (mark.team), then reloads the marks.
 * @param {string} teamId
 * @param {string} questionId
 * @param {"correct" | "wrong"} mark
 */
async function setMark(teamId, questionId, mark) {
  if ((await send("mark.team", { questionId, teamId, mark })).ok) loadDetail();
}

/**
 * Right / Wrong buttons for one team on one question, showing the current mark.
 * @param {string} teamId
 * @param {string} questionId
 */
function markButtons(teamId, questionId) {
  // With no marks loaded, neither button shows as pressed; with marks, no answer counts as wrong.
  const cur = () => (hist.detail ? answerOf(teamId, questionId)?.mark || "wrong" : "");
  return html`<span class="mark-btns">
    <button type="button" class="${() => `btn small ${cur() === "correct" ? "ok" : "ghost"}`}" aria-pressed="${() => (cur() === "correct" ? "true" : "false")}"
      disabled="${() => !enabled("mark.team")}" @click="${() => setMark(teamId, questionId, "correct")}">Right</button>
    <button type="button" class="${() => `btn small ${cur() === "wrong" ? "on-wrong" : "ghost"}`}" aria-pressed="${() => (cur() === "wrong" ? "true" : "false")}"
      disabled="${() => !enabled("mark.team")}" @click="${() => setMark(teamId, questionId, "wrong")}">Wrong</button>
  </span>`;
}

// ---- Reveal ----------------------------------------------------------------

export function revealScreen() {
  queueMicrotask(loadDetail);   // outside the render, so it is not tracked as a dependency
  const r = () => page.view?.reveal;
  const rows = () => {
    const q = r();
    if (!q || !page.view) return [];
    return page.view.teams.map((t) => ({ id: t.id, name: t.name, colour: t.colour, a: answerOf(t.id, q.question.id) }));
  };
  return html`<div class="stage">
    ${stepsLine()}
    <p class="qbig">${() => r()?.question.text || ""}</p>
    <p class="ans"><b>${() => r()?.answerText || ""}</b> <span class="s">${() => (r() ? `· ${r()?.rightCount} of ${page.view?.teams.length || 0} right` : "")}</span></p>
    ${() => (hist.problem ? html`<p class="muted s">${`Team answers could not be loaded: ${hist.problem}`}</p>` : "")}
    <table class="answers-table">
      <thead><tr><th>Team</th><th>Answer</th><th>Mark</th></tr></thead>
      <tbody>${() => rows().map((row) => html`<tr>
        <td><span class="tname">${dot(() => row.colour)}${row.name}</span></td>
        <td>${() => answerOf(row.id, r()?.question.id || "")?.display || "— no answer —"}</td>
        <td>${() => { const qid = r()?.question.id || ""; return [markButtons(row.id, qid).key(qid)]; }}</td></tr>`.key(row.id))}</tbody>
    </table>
    <p class="muted s">Disputes: change any mark until Quiz End. Scores update straight away; every change is kept in the night's history.</p>
  </div>`;
}

// ---- Standings: leaderboard, halftime, ended ----------------------------------

/** The live standings table, each row with a Change a mark button (H-13). */
export function standingsTable() {
  const rows = () => (page.view && page.view.standings ? page.view.standings.rows : []);
  return html`<table class="standings">
    <thead><tr><th class="pos">#</th><th>Team</th><th class="num">This round</th><th class="num">Total</th><th></th><th class="right"><span class="visually-hidden">Marks</span></th></tr></thead>
    <tbody>${() => rows().map((row) => html`<tr>
      <td class="pos">${() => { const x = rows().find((y) => y.teamId === row.teamId); return x ? `${ordinal(x.position)}${x.shared ? "=" : ""}` : ""; }}</td>
      <td><span class="tname">${dot(() => row.colour)}<b>${() => rows().find((y) => y.teamId === row.teamId)?.name || ""}</b>
        ${() => (rows().find((y) => y.teamId === row.teamId)?.jokerThisRound ? html`<span class="pill joker">Joker</span>` : "")}</span></td>
      <td class="num">${() => String(rows().find((y) => y.teamId === row.teamId)?.roundScore ?? "")}</td>
      <td class="num"><b>${() => String(rows().find((y) => y.teamId === row.teamId)?.total ?? "")}</b></td>
      <td class="muted s">${() => decided(rows().find((y) => y.teamId === row.teamId)?.decidedBy)}</td>
      <td class="right"><button type="button" class="btn ghost small" disabled="${() => !enabled("mark.team")}"
        @click="${() => openDialog("dispute", { teamId: row.teamId, name: row.name })}">Change a mark</button></td>
    </tr>`.key(row.teamId))}</tbody>
  </table>`;
}

/** @param {string | undefined} by */
function decided(by) {
  if (by === "tie_breaker") return "tie breaker: round wins";
  if (by === "sudden_death") return "Deadlock";
  if (by === "shared") return "shared";
  return "";
}

/** @param {() => string} title */
function standingsScreen(title) {
  return html`<div class="stage">
    ${() => (page.view && page.view.round && page.view.phase !== "ended" ? stepsLine() : "")}
    <h1>${title}</h1>
    ${() => (page.view?.suddenDeathNeeded
      ? html`<div class="card deadlock-note"><b>${() => `Tied for ${ordinal(page.view?.suddenDeathNeeded?.position || 1)} after the tie breaker:`}</b>
          ${() => (page.view ? page.view.teams.filter((t) => page.view?.suddenDeathNeeded?.teamIds.includes(t.id)).map((t) => t.name).join(", ") : "")}.
          <span class="muted">Start Deadlock to settle it, or end the quiz and they share it.</span></div>` : "")}
    ${() => (page.view?.phase === "ended" ? finalBlock() : "")}
    ${standingsTable()}
    <p class="muted s">A mark changed here updates scores, positions and jokers straight away; the display shows the corrected leaderboard the next time it is shown.</p>
  </div>`;
}

function finalBlock() {
  return html`<div class="card winner">
    <p class="label">On the display</p>
    <p class="qbig">${() => page.view?.lines.winner || "The winner and final standings."}</p>
    <p class="muted">${() => { const p = page.view?.night?.prizes || []; return p.length ? p.map((x) => `${ordinal(x.place)}: ${x.text}`).join(" · ") : ""; }}</p>
    <p class="muted s">The night is saved in History. Close the night to hand the display back to the venue's waiting screen.</p>
  </div>`;
}

export function leaderboardScreen() {
  return standingsScreen(() => {
    const r = page.view?.night?.round;
    return r ? `Leaderboard after round ${r.index + 1}${r.isLast ? " (the last round)" : ""}` : "Leaderboard";
  });
}

export function halftimeScreen() {
  return standingsScreen(() => "Halftime");
}

export function endedScreen() {
  return standingsScreen(() => "Final standings");
}

// ---- Change a mark (dispute) dialog ------------------------------------------

export function disputeDialog() {
  const teamId = ui.d.teamId;
  queueMicrotask(loadDetail);
  /** Rounds that have questions to change: from the history API, else the round on the console. */
  const rounds = () => {
    if (hist.detail) return hist.detail.rounds.filter((r) => r.index >= 0 && r.questions.length > 0);   // -1 is Deadlock
    const v = page.view;
    if (v && v.round && v.night && v.night.round) {
      return [{ index: v.night.round.index, title: v.night.round.title, questions: v.round.questions.slice(0, v.round.shown) }];
    }
    return [];
  };
  const pickRound = () => {
    const list = rounds();
    const want = ui.d.round;
    const found = list.find((r) => r.index === want);
    return found || list[list.length - 1];
  };
  return dialogFrame(`Change a mark: ${ui.d.name}`, html`
    ${() => (hist.loading && !hist.detail ? html`<p class="muted">Loading the team's answers…</p>` : "")}
    ${() => (hist.problem ? html`<p class="form-error">${`The team's answers could not be loaded: ${hist.problem}`}</p>` : "")}
    <div class="q-tabs" role="tablist" aria-label="Rounds">${() => rounds().map((r) => html`<button type="button" role="tab"
      class="${() => `q-tab${pickRound()?.index === r.index ? " on" : ""}`}" @click="${() => { ui.d.round = r.index; }}">${`Round ${r.index + 1}`}</button>`.key(r.index))}</div>
    <table class="answers-table">
      <thead><tr><th>Question</th><th>Their answer</th><th>Mark</th></tr></thead>
      <tbody>${() => (pickRound()?.questions || []).map((q) => html`<tr>
        <td><span class="muted s">${`Q${q.number} · ${q.answerText}`}</span><br>${q.text}</td>
        <td>${() => answerOf(teamId, q.id)?.display || (hist.detail ? "— no answer —" : "")}</td>
        <td>${markButtons(teamId, q.id)}</td></tr>`.key(q.id))}</tbody>
    </table>
    <p class="muted s">${() => `Changes are allowed until Quiz End and are kept in the night's history. ${page.view?.standings ? plural(page.view.standings.rows.length, "team") + " in the standings." : ""}`}</p>`);
}
