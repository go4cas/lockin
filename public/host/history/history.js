// @ts-check
// History (S-08): past nights with their final standings, from GET /api/history and
// GET /api/history/:nightId (TECH-SPEC 9.2). League screens are Launch, not here.
import { html, reactive } from "/vendor/arrow/index.mjs";
import { ordinal, plural } from "../run/logic.js";

/** @typedef {import("../../../src/shared/protocol").HistoryListItem} HistoryListItem */
/** @typedef {import("../../../src/shared/protocol").HistoryDetail} HistoryDetail */

const state = reactive({
  loading: true,
  problem: "",
  /** @type {HistoryListItem[]} */ nights: [],
  /** The night whose standings are open, or "". */
  open: "",
  /** nightId -> detail, loading flag or problem. */
  /** @type {Record<string, { loading: boolean, problem: string, detail: HistoryDetail | null }>} */
  details: {},
});

/** @param {string} url */
async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
  } catch {
    throw new Error("Lock-In could not be reached. Check the connection and try again.");
  }
  if (res.status === 401) {
    location.href = "/host/login?next=/host/history";
    throw new Error("Signed out.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.error && body.error.message) || "That could not be loaded. Try again.");
  return body;
}

async function loadList() {
  state.loading = true;
  state.problem = "";
  try {
    const body = await getJson("/api/history");
    state.nights = (body && Array.isArray(body.nights) ? body.nights : []).slice().sort((/** @type {HistoryListItem} */ a, /** @type {HistoryListItem} */ b) => b.openedAt - a.openedAt);
  } catch (e) {
    state.problem = /** @type {Error} */ (e).message;
  } finally {
    state.loading = false;
  }
}

/** @param {string} id */
async function toggle(id) {
  if (state.open === id) { state.open = ""; return; }
  state.open = id;
  if (state.details[id] && state.details[id].detail) return;
  state.details[id] = { loading: true, problem: "", detail: null };
  try {
    const d = await getJson(`/api/history/${encodeURIComponent(id)}`);
    state.details[id] = { loading: false, problem: "", detail: d };
  } catch (e) {
    state.details[id] = { loading: false, problem: /** @type {Error} */ (e).message, detail: null };
  }
}

/** @param {number | null} t */
function dateText(t) {
  if (t === null || t === undefined) return "";
  return new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** @param {HistoryListItem} n */
function winnersText(n) {
  if (n.endedAt === null) return "Still open";
  if (n.winners.length === 0) return "Ended before a winner";
  return n.winners.join(" and ") + (n.winners.length > 1 ? " (shared)" : "");
}

/** @param {string} id */
function standings(id) {
  return html`<div class="card history-detail">
    ${() => (state.details[id]?.loading ? html`<p class="muted">Loading the standings…</p>` : "")}
    ${() => (state.details[id]?.problem ? html`<p class="form-error">${() => state.details[id]?.problem || ""}</p>` : "")}
    ${() => {
      const d = state.details[id]?.detail;
      if (!d) return "";
      if (d.standings.length === 0) return html`<p class="muted">This night ended before Quiz Start, so it has no standings.</p>`;
      return html`<table>
        <thead><tr><th class="pos">#</th><th>Team</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${() => (state.details[id]?.detail?.standings || []).map((r) => html`<tr>
          <td class="pos">${`${ordinal(r.position)}${r.shared ? "=" : ""}`}</td><td><b>${r.name}</b></td>
          <td class="num">${String(r.total)}</td>
          <td class="muted s">${r.decidedBy === "tie_breaker" ? "tie breaker: round wins" : r.decidedBy === "sudden_death" ? "Deadlock" : r.decidedBy === "shared" ? "shared" : ""}</td></tr>`.key(r.teamId))}</tbody>
      </table>`;
    }}
  </div>`;
}

html`<div class="stage">
  <div class="row between"><h1>History</h1><button type="button" class="btn ghost" @click="${loadList}">Refresh</button></div>
  <p class="muted">Every night is saved when it ends. Open one to see its final standings.</p>
  ${() => (state.loading ? html`<p class="muted">Loading past nights…</p>` : "")}
  ${() => (state.problem ? html`<p class="form-error">${() => state.problem}</p>` : "")}
  ${() => (!state.loading && !state.problem && state.nights.length === 0 ? html`<p class="muted">No nights yet. They appear here after the first Quiz End.</p>` : "")}
  ${() => (state.nights.length ? html`<table class="history">
    <thead><tr><th>Date</th><th>Quiz</th><th class="num">Teams</th><th>Winner</th><th class="right"><span class="visually-hidden">Standings</span></th></tr></thead>
    <tbody>${() => state.nights.map((n) => html`<tr class="${() => `history-row${state.open === n.id ? " open" : ""}`}">
        <td>${dateText(n.openedAt)}</td><td><b>${n.quizTitle}</b></td><td class="num">${String(n.teams)}</td><td>${winnersText(n)}</td>
        <td class="right"><button type="button" class="btn ghost small" aria-expanded="${() => (state.open === n.id ? "true" : "false")}"
          @click="${() => toggle(n.id)}">${() => (state.open === n.id ? "Hide standings" : "Standings")}</button></td></tr>`.key(n.id))}</tbody>
  </table>` : "")}
  ${() => (state.open ? [html`<section class="stack"><h2>${() => { const n = state.nights.find((x) => x.id === state.open); return n ? `${n.quizTitle}, ${dateText(n.openedAt)}: ${plural(n.teams, "team")}` : ""; }}</h2>${standings(state.open)}</section>`.key(state.open)] : "")}
</div>`(/** @type {HTMLElement} */ (document.getElementById("host-main")));

loadList();
