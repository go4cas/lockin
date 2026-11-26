// @ts-check
// Reveal, leaderboard, halftime and Quiz End (H-11, H-12, H-07), and changing a mark
// from the standings (H-13). Earlier rounds' marks come from GET /api/history/:nightId,
// which also answers for the open night (TECH-SPEC 9.2, agreed with Cas 2026-11-24).
import { html, reactive } from "/vendor/arrow/index.mjs";
import { moveMark, ordinal, plural } from "./logic.js";
import { stepsLine } from "./asking.js";
import { enabled, getJson, openDialog, page, send, ui } from "./state.js";
import { dialogFrame, dot, pool } from "./ui.js";

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
 * What a team sent, for the answers tables. A row flagged noAnswer (LI-006) or no row at all
 * reads "no answer"; its mark is shown by the buttons either way. "0" is a real answer.
 * @param {{ display: string, noAnswer?: true } | undefined} a
 * @param {boolean} loaded
 */
function answerText(a, loaded) {
  if (a && !a.noAnswer) return a.display;
  return loaded ? "— no answer —" : "";
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
 * Right / Wrong buttons for one team on one question, showing the current mark. Both
 * ids are read when needed, so one set of buttons follows the row it sits in.
 * @param {() => string} teamId
 * @param {() => string} questionId
 */
function markButtons(teamId, questionId) {
  // With no marks loaded, neither button shows as pressed; with marks, no answer counts as wrong.
  const cur = () => (hist.detail ? answerOf(teamId(), questionId())?.mark || "wrong" : "");
  const set = (/** @type {"correct" | "wrong"} */ m) => { if (teamId() && questionId()) setMark(teamId(), questionId(), m); };
  return html`<span class="mark-btns">
    <button type="button" class="${() => `btn small ${cur() === "correct" ? "ok" : "ghost"}`}" aria-pressed="${() => (cur() === "correct" ? "true" : "false")}"
      disabled="${() => !enabled("mark.team")}" @click="${() => set("correct")}">Right</button>
    <button type="button" class="${() => `btn small ${cur() === "wrong" ? "on-wrong" : "ghost"}`}" aria-pressed="${() => (cur() === "wrong" ? "true" : "false")}"
      disabled="${() => !enabled("mark.team")}" @click="${() => set("wrong")}">Wrong</button>
  </span>`;
}

// ---- Reveal ----------------------------------------------------------------

export function revealScreen() {
  const r = () => page.view?.reveal;
  const qid = () => r()?.question.id || "";
  const teams = () => (r() && page.view ? page.view.teams : []);
  return html`<div class="stage">
    ${stepsLine()}
    <p class="qbig">${() => r()?.question.text || ""}</p>
    <p class="ans"><b>${() => r()?.answerText || ""}</b> <span class="s">${() => (r() ? `· ${r()?.rightCount} of ${page.view?.teams.length || 0} right` : "")}</span></p>
    <p class="muted s" hidden="${() => !hist.problem}">${() => `Team answers could not be loaded: ${hist.problem}`}</p>
    <table class="answers-table">
      <thead><tr><th>Team</th><th>Answer</th><th>Mark</th></tr></thead>
      <tbody>${pool(teams, (t) => html`<tr hidden="${() => !t()}">
        <td><span class="tname">${dot(() => t()?.colour || 1, () => t()?.name || "")}${() => t()?.name || ""}</span></td>
        <td>${() => answerText(answerOf(t()?.id || "", qid()), true)}</td>
        <td>${markButtons(() => t()?.id || "", qid)}</td></tr>`)}</tbody>
    </table>
    <p class="muted s">Disputes: change any mark until Quiz End. Scores update straight away; every change is kept in the night's history.</p>
  </div>`;
}

// ---- Standings: leaderboard, halftime, ended ----------------------------------

/** The live standings table, each row with a Change a mark button (H-13). */
export function standingsTable() {
  const rows = () => (page.view && page.view.standings ? page.view.standings.rows : []);
  return html`<table class="standings">
    <thead><tr><th class="pos">#</th><th class="move"><span class="visually-hidden">Movement</span></th><th>Team</th><th class="num">This round</th><th class="num">Total</th><th></th><th class="right"><span class="visually-hidden">Marks</span></th></tr></thead>
    <tbody>${pool(rows, (x) => html`<tr hidden="${() => !x()}">
      <td class="pos">${() => { const y = x(); return y ? `${ordinal(y.position)}${y.shared ? "=" : ""}` : ""; }}</td>
      <td class="${() => `move ${moveMark(x()).cls}`}" title="${() => moveMark(x()).label}"><span aria-hidden="true">${() => moveMark(x()).text}</span><span class="visually-hidden">${() => moveMark(x()).label}</span></td>
      <td><span class="tname">${dot(() => x()?.colour || 1, () => x()?.name || "")}<b>${() => x()?.name || ""}</b>
        <span class="pill joker" hidden="${() => !x()?.jokerThisRound}">Joker</span></span></td>
      <td class="num">${() => String(x()?.roundScore ?? "")}</td>
      <td class="num"><b>${() => String(x()?.total ?? "")}</b></td>
      <td class="muted s">${() => decided(x()?.decidedBy)}</td>
      <td class="right"><button type="button" class="btn ghost small" disabled="${() => !enabled("mark.team")}"
        @click="${() => { const y = x(); if (y) openDialog("dispute", { teamId: y.teamId, name: y.name }); }}">Change a mark</button></td>
    </tr>`)}</tbody>
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
    <div hidden="${() => !(page.view && page.view.round && page.view.phase !== "ended")}">${stepsLine()}</div>
    <h1>${title}</h1>
    <div class="card deadlock-note" hidden="${() => !page.view?.suddenDeathNeeded}"><b>${() => `Tied for ${ordinal(page.view?.suddenDeathNeeded?.position || 1)} after the tie breaker:`}</b>
      ${() => (page.view ? page.view.teams.filter((t) => page.view?.suddenDeathNeeded?.teamIds.includes(t.id)).map((t) => t.name).join(", ") : "")}.
      <span class="muted">Start Deadlock to settle it, or end the quiz and they share it.</span></div>
    <div hidden="${() => page.view?.phase !== "ended"}">${finalBlock()}</div>
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
  const teamId = () => ui.d.teamId || "";
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
  return dialogFrame(() => `Change a mark: ${ui.d.name || ""}`, html`
    <p class="muted" hidden="${() => !(hist.loading && !hist.detail)}">Loading the team's answers…</p>
    <p class="form-error" hidden="${() => !hist.problem}">${() => `The team's answers could not be loaded: ${hist.problem}`}</p>
    <div class="q-tabs" role="tablist" aria-label="Rounds">${pool(rounds, (r) => html`<button type="button" role="tab" hidden="${() => !r()}"
      class="${() => `q-tab${r() && pickRound()?.index === r()?.index ? " on" : ""}`}" @click="${() => { const x = r(); if (x) ui.d.round = x.index; }}">${() => `Round ${(r()?.index ?? 0) + 1}`}</button>`)}</div>
    <table class="answers-table">
      <thead><tr><th>Question</th><th>Their answer</th><th>Mark</th></tr></thead>
      <tbody>${pool(() => pickRound()?.questions || [], (q) => html`<tr hidden="${() => !q()}">
        <td><span class="muted s">${() => `Q${q()?.number ?? ""} · ${q()?.answerText || ""}`}</span><br>${() => q()?.text || ""}</td>
        <td>${() => answerText(answerOf(teamId(), q()?.id || ""), !!hist.detail)}</td>
        <td>${markButtons(teamId, () => q()?.id || "")}</td></tr>`)}</tbody>
    </table>
    <p class="muted s">${() => `Changes are allowed until Quiz End and are kept in the night's history. ${page.view?.standings ? plural(page.view.standings.rows.length, "team") + " in the standings." : ""}`}</p>`);
}
