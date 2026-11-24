// @ts-check
// Every phone screen as an Arrow template (TECH-SPEC 3.4). Screens follow
// docs/design/wireframes/phone.html and docs/design/screens.md.
// Live values are written ${() => …}; text from the view always goes into a
// ${} slot (a text node or attribute), never into markup (TECH-SPEC 12.4).

import { html, reactive, nextTick, watch } from "/vendor/arrow/index.mjs";
import * as L from "./logic.mjs";
import { page as live, ui, nav, join, rejoin, setJoinMode, send, choose, playJoker, skipJoker, offline } from "./state.mjs";

/** @typedef {import("../../src/shared/protocol").TeamView} TeamView */
/** @typedef {import("../../src/shared/protocol").QuestionPublic} QuestionPublic */

/** @type {any} */
const W = typeof window !== "undefined" ? window : globalThis;
const countdown = (/** @type {number} */ ms, /** @type {boolean} */ short) => W.LockIn.view.countdown(ms, short);
const joinNames = (/** @type {string[]} */ names) => W.LockIn.view.joinNames(names);
const colour = (/** @type {number} */ i) => W.LockIn.view.teamColour(i);

// ---------------------------------------------------------------- screens

/**
 * Builds a fresh set of screens that read the view from `page`. mount() gives each
 * screen its own `page` and only feeds it views while that screen is on show, so a
 * hidden screen never re-renders for a view it was not made for (see mount()).
 * @param {{ view: TeamView | null }} page
 */
function makeScreens(page) {
/** The current view. Screens only run when a view exists, except the few that check. */
const v = () => /** @type {TeamView} */ (page.view);
const self = () => v().self;
const night = () => v().night;

// ---------------------------------------------------------------- pieces

const mark = (/** @type {number} */ w) => html`<svg class="mark" width="${w}" height="${Math.round(w * 1.2)}" viewBox="0 0 100 120" aria-hidden="true"><path d="M28 58 V36 A22 22 0 0 1 72 36 V58" fill="none" stroke="currentColor" stroke-width="11"/><rect x="10" y="54" width="80" height="62" rx="13" fill="var(--color-lock)"/><path d="M40 75 A10 10 0 1 1 55.5 83.3 C51.5 86 50 88 50 92" fill="none" stroke="var(--color-bg)" stroke-width="7.5" stroke-linecap="round"/><circle cx="50" cy="104" r="4.6" fill="var(--color-bg)"/></svg>`;

const tick = () => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const padlock = () => html`<svg class="lockbig" viewBox="0 0 100 120" aria-hidden="true"><path class="shackle" d="M28 58 V36 A22 22 0 0 1 72 36 V58"/><rect class="body" x="10" y="54" width="80" height="62" rx="13"/><path class="qmark" d="M40 75 A10 10 0 1 1 55.5 83.3 C51.5 86 50 88 50 92"/><circle class="hole" cx="50" cy="104" r="4.6"/></svg>`;

/** @type {Record<string, { key: string; n: number }>} */
const generations = {};

/**
 * A list whose rows are never removed: row i always shows item i, rows past the end
 * are hidden, and the list only grows. Arrow 1.0.6 throws ("expressionPool[effect]
 * is not a function", "setEndAfter … has no parent") when it removes a keyed row
 * whose own slots still have updates queued, which happened whenever one view's
 * questions or standings replaced another's (NOTES, B7). Rows read their item
 * through get(), so a reused row always shows the current item.
 * @template T
 * @param {() => T[]} items
 * @param {(get: () => T | undefined, i: number) => any} render
 */
const pool = (items, render) => {
  let size = 0;
  return () => {
    const n = items().length;
    if (n > size) size = n;
    return Array.from({ length: size }, (_, i) => render(() => items()[i], i).key(String(i)));
  };
};

/**
 * One keyed template as a one-item list, for a slot that can show different things
 * (a screen, a question). Two Arrow 1.0.6 behaviours make this necessary (NOTES, B7):
 * a template with the same markup is patched into the old elements even when its
 * .key() differs, so question 4 could keep question 1's input; and a slot remembers
 * a key after its elements are gone, so coming back to that key later reuses detached
 * nodes and throws. A keyed list always mounts a new key fresh, and a generation
 * number makes sure a key is never used twice in the same slot.
 * @param {string} slot
 * @param {any} tpl
 * @param {string} key
 */
const one = (slot, tpl, key) => {
  const g = generations[slot] ?? (generations[slot] = { key: "", n: 0 });
  if (g.key !== key) { g.key = key; g.n++; }
  return [tpl.key(`${key}#${g.n}`)];
};

/** What each swapping slot has mounted now. */
const mounted = reactive({ question: "", deadlock: "" });

/**
 * Shows build() for `key` in a slot that swaps between screens or questions.
 * On a key change the slot shows nothing for one microtask before the new template
 * mounts: replacing a mounted template straight away while Arrow still has
 * updates queued for it throws "expressionPool[effect] is not a function"
 * (seen going from one question to the next; B3 found the same, see NOTES).
 * @param {"question" | "deadlock"} slot
 * @param {string} key
 * @param {() => any} build
 */
const swap = (slot, key, build) => {
  if (mounted[slot] === key) return one(slot, build(), key);
  // Not nextTick: outside an update Arrow runs that straight away, inside this
  // slot's own run, and the slot never runs again (seen on a fresh page load).
  queueMicrotask(() => nextTick(() => { mounted[slot] = key; }));
  return "";
};

const credit = () => html`<div class="credit">Powered by Lock-In</div>`;

/** A host-voice line, or nothing (never carries information the team needs). */
const voice = (/** @type {() => string | null} */ get) => html`${() => (get() ? html`<p class="voice">${() => get() ?? ""}</p>` : "")}`;

/** Top bar: team colour dot, name, where we are, team menu. */
const top = (/** @type {() => string} */ status = () => "", menu = true) => html`
  <header class="ph-top">
    <i class="dot" style="${() => `background:${colour(self()?.colour ?? 1)}`}"></i>
    <span class="team">${() => self()?.name ?? ""}</span>
    <span class="status">${status}</span>
    ${menu ? html`<button class="icon-btn" type="button" aria-label="Team menu" @click="${() => { ui.menu = true; }}">&#8942;</button>` : ""}
  </header>`;

const prizesCard = (/** @type {string} */ label) => html`<section class="card" hidden="${() => !(night()?.prizes ?? []).length}">
  <div class="eyebrow" style="margin-bottom:6px">${label}</div>
  ${pool(() => night()?.prizes ?? [], (p) => html`<div class="prize" hidden="${() => !p()}"><b>${() => L.ordinal(p()?.place ?? 1)}</b><span>${() => p()?.text ?? ""}</span></div>`)}
</section>`;

const homeCard = () => html`
  <section class="card row" style="gap:14px">
    ${mark(34)}
    <div style="flex:1"><div class="small" style="font-weight:700">Put the quiz on your home screen</div><div class="xs muted">Opens full screen next time. Optional.</div></div>
    <button class="link small" type="button" @click="${() => { ui.guide = true; }}">Show me</button>
  </section>`;

/** The round the joker card offers now, or null when it is hidden. */
const jokerOffer = () => {
  const r = L.jokerRoundNow(page.view);
  return r === null || ui.jokerSkip[String(r)] ? null : r;
};
const jokerTitle = () => {
  const r = jokerOffer();
  if (r === null) return "";
  const nr = night()?.round;
  return v().phase === "round_intro" && nr && nr.index === r && nr.title ? nr.title : `round ${r + 1}`;
};

/**
 * The joker offer (P-04): before a round, once per night, confirm before it counts.
 * Always mounted and shown or hidden by attribute, because Arrow 1.0.6 can throw when
 * a slot removes a template (NOTES, B7).
 */
const jokerCard = () => html`<div class="contents">
  <div class="err" role="alert" hidden="${() => !ui.jokerError}">${() => ui.jokerError ?? ""}</div>
  <section class="joker-card" hidden="${() => jokerOffer() === null}">
    <span class="joker-tag">JOKER</span>
    <p class="qtext">${() => (ui.jokerConfirm !== null && ui.jokerConfirm === jokerOffer() ? `Sure? Joker on ${jokerTitle()}?` : `Play your joker on ${jokerTitle()}?`)}</p>
    <p class="small muted">${() => (ui.jokerConfirm !== null && ui.jokerConfirm === jokerOffer()
      ? "You can't take it back or move it once you confirm."
      : "Your points this round count double. One joker per night, and you can't change it once the round starts.")}</p>
    <button class="btn joker" type="button" disabled="${() => ui.jokerBusy || offline()}" @click="${() => { const r = jokerOffer(); if (r !== null) playJoker(r); }}">${() => (ui.jokerConfirm !== null && ui.jokerConfirm === jokerOffer() ? "Yes, play the joker" : `Play joker on ${jokerTitle()}`)}</button>
    <button class="btn ghost" type="button" @click="${() => { const r = jokerOffer(); if (r !== null) skipJoker(r); }}">${() => (ui.jokerConfirm !== null && ui.jokerConfirm === jokerOffer() ? "Cancel" : "Not this round")}</button>
  </section>
</div>`;

// ---------------------------------------------------------------- join

const joinScreen = () => html`
  <div class="ph">
    <main class="ph-body">
      <div class="brand">${mark(40)}<div><div class="eyebrow">Quiz night at</div><h1 class="title">${() => v().venue.name}</h1></div></div>
      ${voice(() => v().lines.lobby)}
      <div class="field">
        <label for="team-name">Team name</label>
        <input id="team-name" class="${() => (ui.joinError && (ui.joinError.code === "name_taken" || ui.joinError.code === "team_has_phone") ? "input bad" : "input")}"
          maxlength="${L.NAME_MAX}" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="go"
          value="${() => ui.name}" @input="${(/** @type {any} */ e) => { ui.name = e.target.value; }}"
          @keydown="${(/** @type {any} */ e) => { if (e.key === "Enter") join(); }}">
        <div class="hint">Up to 30 characters. The quizmaster can fix typos later.</div>
      </div>
      <div class="field">
        <label for="room-code">Room code</label>
        <input id="room-code" class="${() => (ui.joinError && ui.joinError.code === "room_code" ? "input code bad" : "input code")}"
          maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go"
          value="${() => ui.room}" @input="${(/** @type {any} */ e) => { ui.room = e.target.value.toUpperCase(); }}"
          @keydown="${(/** @type {any} */ e) => { if (e.key === "Enter") join(); }}">
        <div class="hint">${() => (L.parsePath(location.pathname).roomCode ? "Filled in from the QR code. On the TV if you need it." : "The 4 letters on the TV.")}</div>
      </div>
      ${() => {
        const e = ui.joinError;
        if (!e) return "";
        if (e.code === "team_has_phone") {
          return html`<div class="stack"><div class="err" role="alert"><b>${() => `${ui.name.trim()} already has a phone.`}</b>Only one phone per team. If your team's phone died, ask it for the rejoin code, or ask the quizmaster to move your team here.</div>
            <button class="link" type="button" @click="${() => setJoinMode("rejoin")}">I have a rejoin code</button></div>`;
        }
        return html`<div class="err" role="alert">${() => ui.joinError?.message ?? ""}</div>`;
      }}
      ${() => (ui.joinError && ui.joinError.code === "team_has_phone" ? "" : html`<button class="link" type="button" @click="${() => setJoinMode("rejoin")}">Already playing? Use a rejoin code</button>`)}
    </main>
    <footer class="ph-foot">
      <button class="btn primary" type="button" disabled="${() => ui.joining || offline()}" @click="${join}">${() => (ui.joining ? "Joining…" : ui.joinError && ui.joinError.code === "team_has_phone" ? "Join with a different name" : "Join the quiz")}</button>
      ${credit()}
    </footer>
  </div>`;

const rejoinScreen = () => html`
  <div class="ph">
    <main class="ph-body">
      <div class="brand">${mark(40)}<div><div class="eyebrow">Rejoin your team</div><h1 class="title">${() => v().venue.name}</h1></div></div>
      <p class="small muted">Your team's old phone shows its rejoin code in the team menu (&#8942;). Your team keeps its name, answers and score.</p>
      <div class="field">
        <label for="rejoin-code">Rejoin code</label>
        <input id="rejoin-code" class="${() => (ui.rejoinError ? "input code bad" : "input code")}" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go"
          value="${() => ui.rejoinCode}" @input="${(/** @type {any} */ e) => { ui.rejoinCode = e.target.value.toUpperCase(); }}"
          @keydown="${(/** @type {any} */ e) => { if (e.key === "Enter") rejoin(); }}">
        <div class="hint">6 letters and numbers. A move link from the quizmaster works too.</div>
      </div>
      ${() => (ui.rejoinError ? html`<div class="err" role="alert">${() => ui.rejoinError ?? ""}</div>` : "")}
    </main>
    <footer class="ph-foot">
      <button class="btn primary" type="button" disabled="${() => ui.rejoining || offline()}" @click="${rejoin}">${() => (ui.rejoining ? "Rejoining…" : "Rejoin my team")}</button>
      ${() => (v().phase === "lobby" && !night()?.started ? html`<button class="btn ghost" type="button" @click="${() => setJoinMode("join")}">Join as a new team instead</button>` : "")}
    </footer>
  </div>`;

const joinClosedScreen = () => html`
  <div class="ph">
    <main class="ph-center">
      ${mark(64)}
      <h1 class="title">The quiz has started</h1>
      <p class="muted small">New teams can't join once the first round begins. Already playing on another phone? Use your team's rejoin code.</p>
    </main>
    <footer class="ph-foot"><button class="btn secondary" type="button" @click="${() => setJoinMode("rejoin")}">Enter a rejoin code</button>${credit()}</footer>
  </div>`;

const noNightScreen = () => html`
  <div class="ph">
    <main class="ph-center">
      ${mark(64)}
      <div class="eyebrow">${() => v().venue.name}</div>
      <h1 class="title">No quiz running right now</h1>
      <p class="muted small">When the quizmaster opens tonight's quiz, scan the QR code on the TV or come back to this page.</p>
    </main>
    <footer class="ph-foot">${credit()}</footer>
  </div>`;

const plainScreen = (/** @type {string} */ title, /** @type {string} */ body, /** @type {string | null} */ action) => () => html`
  <div class="ph">
    <main class="ph-center">
      ${mark(64)}
      <h1 class="title">${title}</h1>
      <p class="muted small">${body}</p>
    </main>
    ${action ? html`<footer class="ph-foot"><a class="btn secondary" href="/">${action}</a></footer>` : ""}
  </div>`;

const connectingScreen = () => html`
  <div class="ph">
    <main class="ph-center">
      ${mark(64)}
      <h1 class="title">${() => (live.status === "offline" ? "Can't reach the quiz" : "Connecting…")}</h1>
      <p class="muted small">${() => (live.status === "offline" ? "Check the pub's Wi-Fi or your mobile data. This page keeps trying on its own." : "")}</p>
    </main>
  </div>`;

const movingScreen = () => html`
  <div class="ph"><main class="ph-center">${mark(64)}<h1 class="title">Moving your team to this phone…</h1></main></div>`;

// ---------------------------------------------------------------- waiting screens

const lobbyScreen = () => html`
  <div class="ph">
    ${top()}
    <main class="ph-body">
      ${() => {
        const start = night()?.plannedStart ?? null;
        const teams = night()?.teamCount ?? 0;
        if (start === null) {
          return html`<section class="card center"><div class="title">You're in!</div><div class="small muted" style="margin-top:6px">${() => `${night()?.teamCount ?? 0} ${night()?.teamCount === 1 ? "team" : "teams"} ready. The quiz starts when the quizmaster says go.`}</div></section>`;
        }
        return html`<section class="card center">
          <div class="muted small">The quiz starts in</div>
          <div class="hero" style="margin:6px 0">${() => {
            const left = (night()?.plannedStart ?? 0) - ui.now;
            return left > 0 ? countdown(left, false) : "Any minute";
          }}</div>
          <div class="small">${() => `at ${new Date(night()?.plannedStart ?? 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${night()?.teamCount ?? teams} ${night()?.teamCount === 1 ? "team" : "teams"} ready`}</div>
        </section>`;
      }}
      ${voice(() => v().lines.lobby)}
      ${jokerCard()}
      ${prizesCard("Tonight's prizes")}
      ${homeCard()}
    </main>
    ${credit()}
  </div>`;

const roundIntroScreen = () => html`
  <div class="ph">
    ${top(() => { const r = night()?.round; return r ? `Round ${r.index + 1}` : ""; })}
    <main class="ph-body">
      <div class="eyebrow">Next up</div>
      <h1 class="title">${() => { const r = night()?.round; return r ? (r.title ? `Round ${r.index + 1}: ${r.title}` : `Round ${r.index + 1}`) : ""; }}</h1>
      ${voice(() => v().lines.round)}
      ${() => {
        const s = self();
        const r = night()?.round;
        if (s && r && s.jokerRound === r.index) return html`<section class="card row"><span class="joker-tag">JOKER</span><span class="small">Played on this round. Points count double.</span></section>`;
        return "";
      }}
      ${jokerCard()}
      ${() => (L.jokerRoundNow(page.view) === null ? html`<p class="small muted">Questions appear here when the quizmaster starts the round.</p>` : "")}
    </main>
  </div>`;

const waitingScreen = () => html`
  <div class="ph">
    ${top()}
    <main class="ph-center">
      <div class="eyebrow">${() => { const r = night()?.round; return r ? `Round ${r.index + 1} is in` : ""; }}</div>
      <h1 class="title">Eyes on the TV</h1>
      <p class="small muted">${() => (v().phase === "reveal" ? "The answers are coming up on the big screen." : "The quizmaster is marking, then the answers come up on the big screen.")}</p>
      ${voice(() => (v().phase === "reveal" ? v().lines.reveal : v().lines.locked))}
    </main>
  </div>`;

const scoreScreen = () => html`
  <div class="ph">
    ${top()}
    <main class="ph-body">
      <div class="eyebrow">${() => { const st = v().standings; return st ? `After round ${st.round + 1} of ${night()?.roundCount ?? st.round + 1}` : "Leaderboard"; }}</div>
      ${() => {
        const row = L.myRow(page.view);
        if (!row) return html`<section class="card center"><div class="title">Scores are on the TV</div></section>`;
        return html`<section class="card center">
          <div class="hero big">${() => { const r = L.myRow(page.view); return r ? (r.shared ? `=${L.ordinal(r.position)}` : L.ordinal(r.position)) : ""; }}</div>
          <div class="small muted" style="margin-top:4px">${() => { const r = L.myRow(page.view); return r ? L.decidedLine(r) : ""; }}</div>
          <div class="stats">
            <div><div class="title">${() => String(L.myRow(page.view)?.total ?? 0)}</div><div class="xs muted">total</div></div>
            <div><div class="title">${() => `+${L.myRow(page.view)?.roundScore ?? 0}`}</div><div class="xs muted">this round</div></div>
          </div>
          ${() => (L.myRow(page.view)?.jokerThisRound ? html`<div style="margin-top:12px"><span class="joker-tag">JOKER</span> <span class="small">doubled this round</span></div>` : "")}
        </section>`;
      }}
      ${voice(() => v().lines.leaderboard)}
      ${() => { const s = L.jokerStatus(page.view); return s ? html`<div class="row between small"><span>Joker</span><span class="muted">${() => L.jokerStatus(page.view) ?? ""}</span></div>` : ""; }}
      ${jokerCard()}
    </main>
  </div>`;

const standingsList = () => html`<ol class="list" aria-label="Standings">${pool(() => v().standings?.rows ?? [], (r) => html`
  <li class="${() => (r() && r()?.teamId === self()?.id ? "me" : "")}" hidden="${() => !r()}"><span class="p pos">${() => { const x = r(); return x ? (x.shared ? `=${x.position}` : String(x.position)) : ""; }}</span><i class="dot" style="${() => `background:${colour(r()?.colour ?? 0)}`}"></i><span class="n">${() => r()?.name ?? ""}</span><span class="joker-tag" hidden="${() => !r()?.jokerThisRound}">JOKER</span><span class="p">${() => String(r()?.total ?? 0)}</span></li>`)}</ol>`;

const halftimeScreen = () => html`
  <div class="ph">
    ${top()}
    <main class="ph-body">
      <h1 class="title" style="font-family:var(--font-display);font-weight:400;font-size:44px;color:var(--color-lock)">Halftime</h1>
      ${voice(() => v().lines.halftime)}
      ${() => {
        const r = L.myRow(page.view);
        return r ? html`<div class="row between"><span class="small">${() => { const m = L.myRow(page.view); return m ? `You're ${m.shared ? "joint " : ""}${L.ordinal(m.position)} with ${m.total}` : ""; }}</span><span class="small muted">${() => { const n = night()?.round; return n ? `Round ${n.index + 2} next` : ""; }}</span></div>` : "";
      }}
      ${jokerCard()}
      ${standingsList()}
      ${prizesCard("Playing for")}
    </main>
  </div>`;

const endScreen = () => html`
  <div class="ph">
    ${top(() => "", false)}
    <main class="ph-body">
      <div class="eyebrow">Final result</div>
      ${() => {
        const r = L.myRow(page.view);
        if (!r) return html`<section class="card center"><div class="title">That's the quiz!</div><div class="small muted">The final scores are on the TV.</div></section>`;
        return html`<section class="card center">
          ${() => (L.myRow(page.view)?.position === 1 ? html`<p class="voice" style="color:var(--color-lock)">Champions</p>` : "")}
          <div class="hero big" style="margin-top:4px">${() => { const m = L.myRow(page.view); return m ? (m.shared ? `=${L.ordinal(m.position)}` : L.ordinal(m.position)) : ""; }}</div>
          <div class="small muted" style="margin-top:6px">${() => { const m = L.myRow(page.view); if (!m) return ""; const how = L.decidedLine(m); return `${m.total} ${m.total === 1 ? "point" : "points"}${how ? ` · ${how.toLowerCase()}` : ""}`; }}</div>
        </section>`;
      }}
      ${() => {
        const r = L.myRow(page.view);
        const prize = r ? L.prizeFor(page.view, r.position) : null;
        if (!prize) return "";
        return html`<section class="card"><div class="eyebrow" style="margin-bottom:6px">Your prize</div><div class="prize"><b>${() => L.ordinal(L.myRow(page.view)?.position ?? 1)}</b><span>${() => `${L.prizeFor(page.view, L.myRow(page.view)?.position ?? 0)?.text ?? ""}. The quizmaster will hand it over.`}</span></div></section>`;
      }}
      ${voice(() => v().lines.winner)}
      ${voice(() => v().lines.goodbye)}
    </main>
    <footer class="ph-foot"><button class="btn secondary" type="button" @click="${() => { ui.guide = true; }}">Add to home screen for next time</button>${credit()}</footer>
  </div>`;

// ---------------------------------------------------------------- answering

/** The question being answered, looked up fresh from the view by id. */
const qById = (/** @type {string} */ id) => L.liveQuestions(page.view).find((q) => q.id === id) ?? null;

const timerBar = (/** @type {string} */ id) => html`
  <div class="${() => {
    const q = qById(id);
    const left = q ? L.timerLeft(q.timer, ui.now) : null;
    return left === null ? "timer idle" : left <= 10_000 ? "timer hot" : "timer";
  }}" role="timer">
    <div class="bar"><b style="${() => {
      const q = qById(id);
      const left = q ? L.timerLeft(q.timer, ui.now) : null;
      const pct = left === null || !q || !q.timer.durationMs ? 100 : Math.min(100, (left / q.timer.durationMs) * 100);
      return `width:${pct.toFixed(1)}%`;
    }}"></b></div>
    <span class="s">${() => {
      const q = qById(id);
      const left = q ? L.timerLeft(q.timer, ui.now) : null;
      if (left === null) return "Timer not started";
      if (q && q.timer.state === "paused") return `${countdown(left, true)} paused`;
      return (offline() ? "~" : "") + countdown(left, true);
    }}</span>
  </div>`;

/** What the server holds for this question (P-05, P-08): received, changed but not sent, or not sent. */
const sentStrip = (/** @type {string} */ id) => html`${() => {
  const q = qById(id);
  if (!q) return "";
  const held = L.answerFor(page.view, id);
  const draft = ui.drafts[id] ?? "";
  const err = ui.sendError[id];
  if (ui.sending[id]) return html`<div class="sent wait" role="status"><span>Sending…</span></div>`;
  if (err) return html`<div class="sent bad" role="alert"><span>${() => ui.sendError[id] ?? ""}</span></div>`;
  if (held && !held.counted) return html`<div class="sent bad" role="status"><span><b>${() => { const h = L.answerFor(page.view, id); return h ? `"${L.formatValue(h.value, qById(id)?.input)}" did not count.` : ""; }}</b> It reached the quizmaster after the lock.</span></div>`;
  if (held && (q.input.type === "choice" || L.draftMatches(q.input, draft, held))) {
    return html`<div class="sent" role="status">${tick()}<span>${() => {
      const h = L.answerFor(page.view, id);
      const qq = qById(id);
      if (!h || !qq) return "";
      const text = L.formatValue(h.value, qq.input);
      return qq.input.type === "choice" ? `Sent: ${text}. Tap another to change.` : `The quizmaster has "${text}". Change it any time before the lock.`;
    }}</span></div>`;
  }
  if (offline()) {
    return html`<div class="sent bad" role="status"><span>${() => ((ui.drafts[id] ?? "").trim() && !L.draftMatches(q.input, ui.drafts[id] ?? "", L.answerFor(page.view, id))
      ? "Not sent. You're offline, so this answer has not reached the quizmaster. Answering opens again as soon as the phone reconnects."
      : "You're offline. Answering is paused until the phone reconnects.")}</span></div>`;
  }
  if (held) return html`<div class="sent wait" role="status"><span>${() => { const h = L.answerFor(page.view, id); return h ? `Changed, not sent yet. The quizmaster still has "${L.formatValue(h.value, qById(id)?.input)}".` : ""; }}</span></div>`;
  return html`<div class="sent wait" role="status"><span>${() => (q.input.type === "choice" ? "Tap an answer to send it." : (ui.drafts[id] ?? "").trim() ? "Not sent yet. Tap Send." : "Nothing sent yet.")}</span></div>`;
}}`;

const setDraft = (/** @type {string} */ id) => (/** @type {any} */ e) => {
  ui.drafts[id] = e.target.value;
  if (ui.sendError[id]) ui.sendError[id] = "";
};
const onEnter = (/** @type {string} */ id) => (/** @type {any} */ e) => {
  if (e.key === "Enter") { const q = qById(id); if (q && !offline()) send(q); }
};

/** The input for the answer type (P-05; docs/design/screens.md notes). */
const answerInput = (/** @type {QuestionPublic} */ q) => {
  const id = q.id;
  const input = q.input;
  if (input.type === "choice") {
    return html`<div class="opts" role="group" aria-label="Options">${input.options.map((opt, i) => html`
      <button type="button" class="${() => (ui.drafts[id] === String(i) && L.answerFor(page.view, id) ? "opt sel" : "opt")}" aria-pressed="${() => (ui.drafts[id] === String(i) ? "true" : "false")}"
        disabled="${() => !!ui.sending[id] || offline()}" @click="${() => { const qq = qById(id); if (qq) choose(qq, i); }}"><b>${"ABCDEFGHIJ"[i] ?? String(i + 1)}</b><span>${opt}</span></button>`.key(i))}</div>`;
  }
  if (input.type === "number") {
    return html`<div class="field"><label for="${`a-${id}`}">Your number</label>
      <input id="${`a-${id}`}" class="input big" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" enterkeyhint="send"
        value="${() => ui.drafts[id] ?? ""}" disabled="${() => offline()}" @input="${setDraft(id)}" @keydown="${onEnter(id)}"></div>`;
  }
  if (input.type === "datetime" && input.precision === "year") {
    const step = (/** @type {number} */ d) => () => {
      const cur = parseInt(ui.drafts[id] ?? "", 10);
      ui.drafts[id] = String(Number.isFinite(cur) ? cur + d : 2000);
      ui.sendError[id] = "";
    };
    return html`<div class="field"><label for="${`a-${id}`}">Year</label><div class="stepper">
      <button class="btn secondary" type="button" aria-label="Year down" disabled="${() => offline()}" @click="${step(-1)}">&minus;</button>
      <input id="${`a-${id}`}" class="input big" type="text" inputmode="numeric" maxlength="5" autocomplete="off" enterkeyhint="send"
        value="${() => ui.drafts[id] ?? ""}" disabled="${() => offline()}" @input="${setDraft(id)}" @keydown="${onEnter(id)}">
      <button class="btn secondary" type="button" aria-label="Year up" disabled="${() => offline()}" @click="${step(1)}">+</button></div></div>`;
  }
  if (input.type === "datetime") {
    const kind = input.precision === "date" ? "date" : "time";
    return html`<div class="field"><label for="${`a-${id}`}">${kind === "date" ? "Date" : "Time"}</label>
      <input id="${`a-${id}`}" class="input big" type="${kind}" value="${() => ui.drafts[id] ?? ""}" disabled="${() => offline()}" @input="${setDraft(id)}" @change="${setDraft(id)}"></div>`;
  }
  // Free text: autocorrect off so phones don't "fix" a band name (Design).
  return html`<div class="field"><label for="${`a-${id}`}">Your answer</label>
    <input id="${`a-${id}`}" class="input" type="text" maxlength="${L.TEXT_MAX}" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="send"
      value="${() => ui.drafts[id] ?? ""}" disabled="${() => offline()}" @input="${setDraft(id)}" @keydown="${onEnter(id)}"></div>`;
};

const eyebrowFor = (/** @type {QuestionPublic} */ q) => {
  if (q.input.type === "datetime") return q.input.precision === "year" ? "Answer with a year" : q.input.precision === "date" ? "Answer with a date" : "Answer with a time";
  if (q.input.type === "choice") return "Multiple choice";
  if (q.input.type === "number") return "Answer with a number";
  return "";
};

/** An open question: timer, picture, text, input, what the server holds, Send. Keyed by question id. */
const openQuestion = (/** @type {QuestionPublic} */ q) => html`<div class="contents">
  <div class="ph-body">
    ${timerBar(q.id)}
    ${eyebrowFor(q) ? html`<div class="eyebrow">${eyebrowFor(q)}</div>` : ""}
    ${q.image ? html`<button class="qimg" type="button" aria-label="Enlarge the picture" @click="${() => { ui.zoom = q.image; }}"><img src="${q.image}" alt="Picture for this question"></button>` : ""}
    <p class="qtext">${() => qById(q.id)?.text ?? ""}</p>
    ${answerInput(q)}
    ${sentStrip(q.id)}
  </div>
  ${q.input.type === "choice" ? "" : html`<footer class="ph-foot"><button class="btn primary" type="button"
    disabled="${() => {
      if (ui.sending[q.id] || offline()) return true;
      const draft = ui.drafts[q.id] ?? "";
      const held = L.answerFor(page.view, q.id);
      return !draft.trim() || L.draftMatches(q.input, draft, held);
    }}" @click="${() => { const qq = qById(q.id); if (qq) send(qq); }}">Send answer</button></footer>`}</div>`;

/** A locked question (P-06): the locked-in answer, nothing sent, or a late answer that did not count. */
const lockedQuestion = (/** @type {QuestionPublic} */ q) => html`
  <div class="ph-center">
    ${padlock()}
    <h1 class="title locked-title">Answers locked</h1>
    ${() => {
      const held = L.answerFor(page.view, q.id);
      const qq = qById(q.id) ?? q;
      if (held && held.counted) {
        return html`<section class="card" style="min-width:260px"><div class="xs muted">You locked in</div><div class="qtext">${() => { const h = L.answerFor(page.view, q.id); return h ? L.formatValue(h.value, qq.input) : ""; }}</div></section>`;
      }
      const late = held && !held.counted ? `"${L.formatValue(held.value, qq.input)}" did not count. It reached the quizmaster after the lock.` : ui.sendError[q.id] ? ui.sendError[q.id] : "";
      return html`<div class="stack">${late ? html`<div class="sent bad" style="text-align:left"><span><b>${late}</b></span></div>` : ""}<p class="small muted">No answer was sent before the lock, so this one scores 0.</p></div>`;
    }}
    ${voice(() => (v().phase === "sudden_death" ? null : v().lines.locked))}
  </div>`;

const askingScreen = () => html`
  <div class="ph">
    ${top(() => {
      const qs = v().questions;
      return L.progressLabel(page.view, L.pickQuestion(qs, ui.picked));
    })}
      <div class="ph-body" style="flex:0;padding-bottom:0" hidden="${() => !(night()?.lockMode === "round" && v().questions.length > 1)}">
        <p class="small muted">Answers stay open until the round locks. Dot = sent.</p>
        <nav class="qnav" aria-label="Questions">${pool(() => v().questions, (q) => html`<button type="button" hidden="${() => !q()}"
          class="${() => {
            const it = q();
            if (!it) return "";
            const cur = L.pickQuestion(v().questions, ui.picked);
            return [L.answerFor(page.view, it.id) ? "done" : "", cur && cur.id === it.id ? "on" : "", it.status === "locked" ? "locked" : ""].join(" ").trim();
          }}" aria-label="${() => `Question ${q()?.number ?? ""}`}" @click="${() => { const it = q(); if (it) ui.picked = it.id; }}">${() => String(q()?.number ?? "")}</button>`)}</nav>
      </div>
    ${() => {
      const qs = v().questions;
      if (!qs.length) {
        return swap("question", "ready", () => html`<div class="ph-center"><div class="eyebrow">${() => { const r = night()?.round; return r ? `Round ${r.index + 1}` : ""; }}</div><h1 class="title">Get ready</h1><p class="small muted">The first question is coming up.</p>${voice(() => v().lines.question)}</div>`);
      }
      const q = L.pickQuestion(qs, ui.picked);
      if (!q) return "";
      return q.status === "open" ? swap("question", `open-${q.id}`, () => openQuestion(q)) : swap("question", `locked-${q.id}`, () => lockedQuestion(q));
    }}
  </div>`;

// ---------------------------------------------------------------- sudden death (Deadlock)

const deadlockHead = () => html`<div><div class="dl-tag">Sudden death</div><div class="dl-word">Dead<em>lock</em></div></div>`;

const opponents = () => {
  const sd = v().suddenDeath;
  const me = self()?.id;
  return sd ? sd.teams.filter((t) => t.id !== me).map((t) => t.name) : [];
};

const deadlockInScreen = () => html`
  <div class="ph dl">
    ${top(() => { const sd = v().suddenDeath; return sd ? `Q${sd.questionNumber} of up to ${sd.maxQuestions}` : ""; }, false)}
    ${() => {
      const sd = v().suddenDeath;
      const q = sd?.question ?? null;
      const intro = html`<div class="ph-body" style="flex:0;padding-bottom:0">${deadlockHead()}<p class="small muted">${() => `You vs ${joinNames(opponents())} for ${L.ordinal(v().suddenDeath?.position ?? 1)} place.`}</p>${voice(() => v().lines.suddenDeath)}</div>`;
      if (!sd || !q || sd.status === "waiting") {
        return swap("deadlock", "waiting", () => html`<div class="contents">${intro}<div class="ph-center"><h1 class="title">Next question coming</h1><p class="small muted">Only the tied teams answer. Get ready.</p></div></div>`);
      }
      if (sd.status === "revealed") {
        const right = (sd.rightIds ?? []).includes(self()?.id ?? "");
        return swap("deadlock", `revealed-${q.id}-${right}`, () => html`<div class="contents">${intro}<div class="ph-center"><h1 class="title">${right ? "You got it right" : "Not this time"}</h1>
          <p class="small muted">${() => {
            const o = v().suddenDeath?.outcome;
            if (!o) return "Still level. Another question is coming.";
            const won = o.teamIds.includes(self()?.id ?? "");
            if (o.result === "shared") return `Still tied after the last question, so ${L.ordinal(o.position)} place is shared.`;
            return won ? `You take ${L.ordinal(o.position)} place.` : `${L.ordinal(o.position)} place goes to the other team.`;
          }}</p></div></div>`);
      }
      return q.status === "open" ? swap("deadlock", `open-${q.id}`, () => html`<div class="contents">${intro}${openQuestion(q)}</div>`) : swap("deadlock", `locked-${q.id}`, () => html`<div class="contents">${intro}${lockedQuestion(q)}</div>`);
    }}
  </div>`;

const deadlockWatchScreen = () => html`
  <div class="ph dl">
    ${top(() => "", false)}
    <main class="ph-center">
      ${deadlockHead()}
      <p class="small muted">${() => `For ${L.ordinal(v().suddenDeath?.position ?? 1)} place`}</p>
      <p class="qtext">${() => (v().suddenDeath?.teams ?? []).map((t) => t.name).join(" vs ")}</p>
      <p class="small muted">${() => {
        const r = L.myRow(page.view);
        return r ? `Only they answer. You finished ${r.shared ? "joint " : ""}${L.ordinal(r.position)}. Watch the TV.` : "Only they answer. Watch the TV.";
      }}</p>
      ${voice(() => v().lines.suddenDeath)}
    </main>
  </div>`;

return {
  connecting: connectingScreen,
  moving: movingScreen,
  moved: plainScreen("Your team is on another phone now", "Someone used your team's rejoin code, or the quizmaster moved your team. If that wasn't you, tell the quizmaster.", "Back to the start"),
  removed: plainScreen("Your team was removed", "The quizmaster removed your team from tonight's quiz. Ask them if you think it's a mistake.", "Back to the start"),
  "no-night": noNightScreen,
  join: joinScreen,
  rejoin: rejoinScreen,
  "join-closed": joinClosedScreen,
  lobby: lobbyScreen,
  "round-intro": roundIntroScreen,
  asking: askingScreen,
  waiting: waitingScreen,
  score: scoreScreen,
  halftime: halftimeScreen,
  "deadlock-in": deadlockInScreen,
  "deadlock-watch": deadlockWatchScreen,
  end: endScreen,
};
}

/** The live view, for the sheets and overlays that sit above every screen. */
const self = () => live.view?.self ?? null;

// ---------------------------------------------------------------- sheets and overlays

const menuSheet = () => html`
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Team menu" @click="${(/** @type {any} */ e) => { if (e.target === e.currentTarget) ui.menu = false; }}">
    <div class="panel">
      <h2 class="title" style="font-size:22px">${() => self()?.name ?? ""}</h2>
      <div>
        <div class="small" style="font-weight:700;margin-bottom:6px">Rejoin code</div>
        <div class="rejoin">${() => self()?.rejoinCode ?? ""}</div>
        <div class="hint">Phone dying? Open the quiz on another phone, tap "Use a rejoin code" and type this. Your team keeps its answers and score.</div>
      </div>
      ${() => { const s = L.jokerStatus(live.view); return s ? html`<div class="row between small"><span>Joker</span><span class="muted">${() => L.jokerStatus(live.view) ?? ""}</span></div>` : ""; }}
      <button class="link small" type="button" @click="${() => { ui.menu = false; ui.guide = true; }}">Add to home screen</button>
      <button class="btn secondary" type="button" @click="${() => { ui.menu = false; }}">Close</button>
    </div>
  </div>`;

const STEPS = {
  ios: ["Tap <Share> at the bottom of Safari (the square with an arrow).", "Scroll down and tap <Add to Home Screen>.", "Tap <Add>. Next time, open the quiz from your home screen."],
  android: ["Tap the <⋮> menu at the top right of Chrome.", "Tap <Add to Home screen> or <Install app>.", "Tap <Install> or <Add>. Next time, open the quiz from your home screen."],
};

/** "Tap <Share> at…" → text with the <bits> in bold, as nodes (never markup). */
const stepText = (/** @type {string} */ s) => s.split(/(<[^>]+>)/).map((part) => (part.startsWith("<") ? html`<b>${part.slice(1, -1)}</b>` : part));

const guideAnim = () => html`<div class="guide-anim" aria-hidden="true"><svg viewBox="0 0 120 200">
  <rect class="frame" x="10" y="4" width="100" height="192" rx="14"/>
  <rect class="bar" x="16" y="${() => (ui.guideTab === "ios" ? 168 : 12)}" width="88" height="20" rx="4"/>
  <circle class="tap" cx="${() => (ui.guideTab === "ios" ? 60 : 96)}" cy="${() => (ui.guideTab === "ios" ? 178 : 22)}" r="9"/>
  <rect class="icon" x="${() => (ui.guideTab === "ios" ? 56 : 94)}" y="${() => (ui.guideTab === "ios" ? 172 : 16)}" width="${() => (ui.guideTab === "ios" ? 8 : 4)}" height="12" rx="1"/>
  <rect class="menu" x="20" y="${() => (ui.guideTab === "ios" ? 76 : 38)}" width="80" height="86" rx="6"/>
  <rect class="row menu" x="26" y="${() => (ui.guideTab === "ios" ? 84 : 46)}" width="68" height="14" rx="3"/>
  <rect class="row hit menu" x="26" y="${() => (ui.guideTab === "ios" ? 104 : 66)}" width="68" height="14" rx="3"/>
  <rect class="row menu" x="26" y="${() => (ui.guideTab === "ios" ? 124 : 86)}" width="68" height="14" rx="3"/>
  <rect class="row menu" x="26" y="${() => (ui.guideTab === "ios" ? 144 : 106)}" width="68" height="14" rx="3"/>
</svg></div>`;

const guideSheet = () => html`
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Add to home screen">
    <div class="panel" style="max-height:100vh;border-radius:0;min-height:100vh;min-height:100dvh">
      <div class="row"><button class="icon-btn back" type="button" aria-label="Back" @click="${() => { ui.guide = false; }}">&#8592;</button><h2 class="small" style="margin:0;font-weight:700">Add to home screen</h2></div>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" class="${() => (ui.guideTab === "ios" ? "on" : "")}" aria-selected="${() => (ui.guideTab === "ios" ? "true" : "false")}" @click="${() => { ui.guideTab = "ios"; }}">iPhone</button>
        <button type="button" role="tab" class="${() => (ui.guideTab === "android" ? "on" : "")}" aria-selected="${() => (ui.guideTab === "android" ? "true" : "false")}" @click="${() => { ui.guideTab = "android"; }}">Android</button>
      </div>
      ${guideAnim()}
      <ol class="steps">${() => STEPS[ui.guideTab === "ios" ? "ios" : "android"].map((s, i) => html`<li>${stepText(s)}</li>`.key(`${ui.guideTab}-${i}`))}</ol>
      <p class="xs muted">Nothing to install from a store. Playing in the browser works just the same.</p>
      <button class="btn secondary" type="button" @click="${() => { ui.guide = false; }}">Done</button>
    </div>
  </div>`;

const zoomView = () => html`<button class="zoom" type="button" aria-label="Close the picture" @click="${() => { ui.zoom = null; }}"><img src="${() => ui.zoom ?? ""}" alt="Picture for this question"></button>`;

const toastView = () => html`<div class="toast" role="status">${() => ui.toast?.line ?? ""}</div>`;

// ---------------------------------------------------------------- root



const root = html`
  ${() => (offline() ? html`<div class="banner" role="status"><i></i>Offline. Reconnecting…</div>` : "")}
  <div class="screens"></div>
  ${() => (ui.menu && live.view?.self ? menuSheet() : "")}
  ${() => (ui.guide ? guideSheet() : "")}
  ${() => (ui.zoom ? zoomView() : "")}
  ${() => (ui.toast ? toastView() : "")}
`;

/** @param {Record<string, () => any>} screens */
const connectingScreenOf = (screens) => /** @type {() => any} */ (screens.connecting);

/**
 * Mounts the page. Each screen is built the first time it is needed and then stays
 * mounted, hidden while another screen shows. Arrow 1.0.6 does not reliably stop the
 * slots inside a template it has removed: when a new view removed a screen, its
 * lists still re-rendered into detached nodes and threw ("setEndAfter … has no
 * parent", "expressionPool[effect] is not a function"), seen in a stress test of
 * 400 random fixture views. Screens that are never removed cannot hit that (NOTES, B7).
 * Each screen also gets its own copy of the view, fed only while it is on show, so a
 * hidden screen keeps its last view and never re-renders for one it was not made for.
 * @param {HTMLElement} app
 */
export function mount(app) {
  root(app);
  const holder = /** @type {HTMLElement} */ (app.querySelector(".screens"));
  /** @type {Record<string, { box: HTMLElement; page: { view: TeamView | null } }>} */
  const built = {};
  /** @type {string | null} */
  let showing = null;
  const feed = () => {
    const name = nav.screen;
    const view = live.view;
    if (!name) return;
    let s = built[name];
    if (!s) {
      const box = document.createElement("div");
      box.className = "screen";
      box.hidden = true;
      holder.appendChild(box);
      const page = reactive({ view });
      const screens = /** @type {Record<string, () => any>} */ (makeScreens(page));
      const build = screens[name] ?? connectingScreenOf(screens);
      build()(box);
      s = built[name] = { box, page };
    } else if (s.page.view !== view) {
      s.page.view = view;
    }
    if (showing !== name) {
      const old = showing ? built[showing] : undefined;
      if (old) old.box.hidden = true;
      s.box.hidden = false;
      showing = name;
    }
  };
  watch(() => [nav.screen, live.view], feed);
}
