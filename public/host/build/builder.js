// @ts-check
// Quiz builder (H-02, H-03, H-04). The open quiz is a local reactive() draft;
// a watch() on it drives the debounced autosave (TECH-SPEC 3.4, B3).
import { html, nextTick, reactive, watch } from "/vendor/arrow/index.mjs";
import { loading, spinner } from "../loading.js";
import { ApiError, getQuiz, isOffline, groupProblems, readinessLabel, saveQuiz, uploadImage } from "./api.js";
import { prepareImage } from "./image.js";

/** @typedef {import("./api.js").QuizDraft} QuizDraft */
/** @typedef {import("./api.js").Problem} Problem */
/** @typedef {import("../../../src/shared/formats").DraftQuestion} Question */
/** @typedef {import("../../../src/shared/formats").DraftRound} Round */
/** @typedef {import("../../../src/shared/formats").DraftAnswer} AnswerSpec */
/**
 * What the editor shows: the quiz's settings, a round, a question, the sudden-death list, or the
 * Rounds tab with nothing picked. The tab (Rounds, Sudden death, Settings) follows from it.
 * @typedef {{ kind: "quiz" | "rounds" | "round" | "question" | "sd" | "none", id: string }} Selection
 */

export const AUTOSAVE_MS = 1000;
const ANSWER_TYPES = /** @type {const} */ ([
  ["text", "Text"], ["choice", "Choice"], ["number", "Number"], ["closest", "Closest"], ["datetime", "Date or time"],
]);
/** Sudden death allows typed answers, multiple choice and closest number only (H-14). */
const SD_TYPES = ["text", "choice", "closest"];

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
/** @param {"r-" | "q-"} prefix */
function newId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = prefix;
  for (const b of bytes) s += ID_CHARS[b % ID_CHARS.length];
  return s;
}
/** @returns {Question} */
const emptyQuestion = () => ({ id: newId("q-"), text: "", answer: { type: "text", accepted: [""] } });

/**
 * A fresh answer of a type, for switching types.
 * @param {string} type
 * @returns {AnswerSpec}
 */
function blankAnswer(type) {
  switch (type) {
    case "choice": return { type: "choice", options: ["", ""], correct: -1 };
    case "number": return { type: "number", value: null };
    case "closest": return { type: "closest", value: null };
    case "datetime": return { type: "datetime", precision: "year", value: "", scoring: "exact" };
    default: return { type: "text", accepted: [""] };
  }
}

/** @param {Event} e */
const val = (e) => /** @type {HTMLInputElement} */ (e.target).value;
/** "" -> null, else a number (or null if it isn't one). @param {string} s */
const num = (s) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
/** @param {string} s @param {number} n */
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** @param {HTMLElement} root @param {string} quizId */
export function mountBuilder(root, quizId) {
  const ui = reactive({
    /** the quiz being edited (local; the server never overwrites it) */
    draft: /** @type {QuizDraft | null} */ (null),
    /** updatedAt of the last save, sent as baseUpdatedAt (409 check) */
    base: "",
    /** whether the page shows the builder; separate from status so saving never rebuilds the page */
    phase: /** @type {"loading" | "open" | "missing"} */ ("loading"),
    status: /** @type {"loading" | "saved" | "pending" | "saving" | "error" | "conflict" | "locked"} */ ("loading"),
    message: "",
    ready: false,
    problems: /** @type {Problem[]} */ ([]),
    sel: /** @type {Selection} */ ({ kind: "rounds", id: "" }),
    /** the "also accept" field being typed */
    accept: "",
    uploading: false,
    uploadError: "",
  });
  /** Earlier answers per question and type, so switching type and back keeps what was typed. */
  /** @type {Record<string, Record<string, any>>} */
  const answerCache = {};

  // ---- Autosave -------------------------------------------------------------
  let lastSent = "";
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let inFlight = false;
  /** The last save failed because the server could not be reached (ApiError code "offline"): retry on a timer. */
  let offline = false;

  const draftJson = () => (ui.draft ? JSON.stringify(ui.draft) : "");

  function schedule(delay = AUTOSAVE_MS) {
    if (ui.status === "conflict" || ui.status === "locked") return;
    if (ui.status !== "error") ui.status = "pending";
    clearTimeout(timer);
    timer = setTimeout(saveNow, delay);
  }

  async function saveNow() {
    if (!ui.draft || inFlight || ui.status === "conflict" || ui.status === "locked") return;
    const json = draftJson();
    if (json === lastSent) { ui.status = "saved"; return; }
    inFlight = true;
    ui.status = "saving";
    try {
      const res = await saveQuiz(JSON.parse(json), ui.base);
      lastSent = json;
      ui.base = res.quiz.updatedAt;
      ui.ready = res.ready;
      ui.problems = res.problems;
      ui.message = "";
      offline = false;
      ui.status = draftJson() === json ? "saved" : "pending";
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "error", String(e));
      ui.message = err.message;
      offline = isOffline(err);
      if (err.code === "edited_elsewhere") ui.status = "conflict";
      else if (err.code === "quiz_in_use") ui.status = "locked";
      else ui.status = "error";
    } finally {
      inFlight = false;
    }
    if (ui.status === "pending") schedule();
    else if (ui.status === "error" && offline) schedule(5000);
  }

  // Any change to the draft (re)starts the debounce.
  watch(draftJson, (json) => {
    if (!json || json === lastSent) return;
    schedule();
  });

  // Unsaved edits: the design system's dialog for links, the browser's prompt on reload (UI-16).
  /** @type {any} */ (window).LockIn.nav.guardUnsaved(() => !!ui.draft && draftJson() !== lastSent);

  // ---- Lookups and edits ----------------------------------------------------
  const d = () => /** @type {QuizDraft} */ (ui.draft);

  /** @param {string} id */
  function findQuestion(id) {
    const quiz = d();
    for (let r = 0; r < quiz.rounds.length; r++) {
      const list = /** @type {Round} */ (quiz.rounds[r]).questions;
      const i = list.findIndex((q) => q.id === id);
      if (i >= 0) return { q: /** @type {Question} */ (list[i]), list, i, round: r, sd: false };
    }
    const list = quiz.suddenDeath;
    const i = list.findIndex((q) => q.id === id);
    if (i >= 0) return { q: /** @type {Question} */ (list[i]), list, i, round: -1, sd: true };
    return null;
  }
  /** @param {string} id */
  const roundIndex = (id) => d().rounds.findIndex((r) => r.id === id);

  /** @param {Selection["kind"]} kind @param {string} [id] */
  function select(kind, id = "") {
    // Arrow reuses a chunk when the new template has the same shape and only
    // re-binds its direct slots; templates nested as constants keep the old
    // question's handlers. Going through an empty editor makes a fresh one.
    if (ui.sel.kind !== kind || ui.sel.id !== id) {
      ui.sel = { kind: "none", id: "" };
      nextTick(() => { ui.sel = { kind, id }; });
    }
    ui.accept = "";
    ui.uploadError = "";
    const main = root.querySelector(".b-editor");
    if (main) main.scrollTop = 0;
  }

  /**
   * Moves item i of a list by `by` places.
   * @template T @param {T[]} list @param {number} i @param {number} by
   */
  function move(list, i, by) {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const item = /** @type {T} */ (list.splice(i, 1)[0]);
    list.splice(j, 0, item);
  }

  function addRound() {
    const quiz = d();
    if (quiz.rounds.length >= 20) return;
    const round = { id: newId("r-"), title: "", questions: [emptyQuestion()] };
    quiz.rounds.push(round);
    select("round", round.id);
  }

  /** @param {Question[]} list @param {number} max @param {boolean} sd */
  function addQuestion(list, max, sd) {
    if (list.length >= max) return;
    const q = emptyQuestion();
    list.push(q);
    select(sd ? "question" : "question", q.id);
  }

  /** The design system's dialog for a delete (UI-41). @param {string} title @param {string} text @param {string} ok */
  const askDelete = (title, text, ok) => {
    return /** @type {any} */ (window).LockIn.nav.ask({ title, text, ok, cancel: "Keep it", danger: true });
  };

  /** Runs `fn` once Arrow has drawn the current change. nextTick() can run before the queued
   *  updates, so a delete there could reach an outline row that is being taken down in the same
   *  flush ("expressionPool[effect] is not a function", UI-45). A new task always comes after.
   *  @param {() => void} fn */
  const afterDraw = (fn) => { setTimeout(fn, 0); };

  /** @param {string} id */
  async function deleteRound(id) {
    const quiz = d();
    const i = roundIndex(id);
    if (i < 0) return;
    const r = /** @type {Round} */ (quiz.rounds[i]);
    const filled = r.questions.filter((q) => q.text.trim() !== "").length;
    const name = r.title ? `round ${i + 1}, “${r.title}”` : `round ${i + 1}`;
    const ok = await askDelete(`Delete ${name}?`,
      filled > 0 ? `Its ${filled} written question${filled === 1 ? "" : "s"} go with it. This can't be undone.` : "It has no written questions.",
      "Delete round");
    if (!ok || roundIndex(id) < 0) return;
    // Unmount the editor before the round goes, so no queued update points at it.
    ui.sel = { kind: "none", id: "" };
    afterDraw(() => {
      const at = roundIndex(id);
      if (at >= 0) quiz.rounds.splice(at, 1);
      const next = quiz.rounds[Math.min(Math.max(at, 0), quiz.rounds.length - 1)];
      // Select in a later task: the outline must finish dropping the row before its highlight changes (UI-58).
      afterDraw(() => { if (next) select("round", next.id); else select("rounds"); });
    });
  }

  /** @param {string} id */
  async function deleteQuestion(id) {
    const f = findQuestion(id);
    if (!f) return;
    const q = f.q;
    if (q.text.trim() !== "" && !(await askDelete("Delete this question?", `“${short(q.text, 60)}” and its answer go. This can't be undone.`, "Delete question"))) return;
    if (!findQuestion(id)) return;
    ui.sel = { kind: "none", id: "" };
    afterDraw(() => {
      const g = findQuestion(id);
      if (!g) return select("quiz");
      g.list.splice(g.i, 1);
      const roundId = g.sd ? "" : /** @type {Round} */ (d().rounds[g.round]).id;
      // Back to the list it was in, after the lists have redrawn (UI-58).
      afterDraw(() => { if (g.sd) select("sd"); else select("round", roundId); });
    });
  }

  /** @param {Question} q @param {string} type */
  function setType(q, type) {
    if (q.answer.type === type) return;
    const cache = (answerCache[q.id] ??= {});
    cache[q.answer.type] = JSON.parse(JSON.stringify(q.answer));
    q.answer = cache[type] ?? blankAnswer(type);
  }

  /** Goes to the part of the quiz a problem's path points at. @param {string} path */
  function goTo(path) {
    const quiz = d();
    let m = /^rounds\.(\d+)\.questions\.(\d+)/.exec(path);
    if (m) { const q = quiz.rounds[Number(m[1])]?.questions[Number(m[2])]; if (q) return select("question", q.id); }
    m = /^rounds\.(\d+)/.exec(path);
    if (m) { const r = quiz.rounds[Number(m[1])]; if (r) return select("round", r.id); }
    m = /^suddenDeath\.(\d+)/.exec(path);
    if (m) { const q = quiz.suddenDeath[Number(m[1])]; if (q) return select("question", q.id); }
    select("quiz");
  }

  /** @param {Question} q @param {Event} e */
  async function pickImage(q, e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    ui.uploadError = "";
    ui.uploading = true;
    try {
      const img = await prepareImage(file);
      const name = await uploadImage(d().id, q.id, img.blob, img.name);
      const alt = q.media && q.media.alt;
      q.media = alt ? { kind: "image", file: name, alt } : { kind: "image", file: name };
    } catch (err) {
      ui.uploadError = err instanceof Error ? err.message : String(err);
    } finally {
      ui.uploading = false;
    }
  }

  // ---- Status ---------------------------------------------------------------
  const statusPill = () => {
    switch (ui.status) {
      case "saved": return html`<span class="pill ok" role="status"><i></i>Saved</span>`;
      case "pending": case "saving": return html`<span class="pill active" role="status">${spinner()}Saving</span>`;
      case "loading": return html`<span class="pill active" role="status">${spinner()}Opening</span>`;
      default: return html`<span class="pill bad" role="status"><i></i>Not saved</span>`;
    }
  };

  const banner = () => {
    if (ui.status === "conflict") {
      return html`<div class="banner warn" role="alert"><span>${() => ui.message}</span>
        <button type="button" class="btn ghost" @click="${() => location.reload()}">Reload</button></div>`;
    }
    if (ui.status === "locked") {
      return html`<div class="banner warn" role="alert"><span>${() => ui.message}</span>
        <a class="btn ghost" href="/host/run">Go to the night</a></div>`;
    }
    if (ui.status === "error") return html`<div class="banner bad" role="alert">${() => ui.message} Your changes are kept on this page.</div>`;
    return "";
  };

  // ---- Tabs and outline -----------------------------------------------------
  // Like Venue settings: the page title with a segmented tab bar (Rounds, Sudden death,
  // Settings), as in the design canvas. The left column lists only what the tab holds.

  /** Is this question in sudden death? @param {string} id */
  const inSd = (id) => d().suddenDeath.some((q) => q.id === id);
  /** @returns {"rounds" | "sd" | "settings"} */
  const tab = () => {
    const s = ui.sel;
    if (s.kind === "quiz") return "settings";
    if (s.kind === "sd" || (s.kind === "question" && inSd(s.id))) return "sd";
    return "rounds";
  };
  /** @param {"rounds" | "sd" | "settings"} t */
  function showTab(t) {
    if (t === tab() && ui.sel.kind !== "none") return;
    if (t === "settings") return select("quiz");
    if (t === "sd") return select("sd");
    const first = d().rounds[0];
    return first ? select("round", first.id) : select("rounds");
  }
  const TABS = /** @type {const} */ ([["rounds", "Rounds"], ["sd", "Sudden death"], ["settings", "Settings"]]);

  /** One line per round: its number, title and question count; the round's questions are in its editor (UI-57).
   *  Keyed by id and place, so a move or delete redraws the number, and nothing in a row reads the rounds
   *  list itself: a row that did was taken down while its own update was queued (UI-58).
   *  @param {Round} r @param {number} i */
  const outlineRound = (r, i) => html`
    <li>
      <a href="#" class="b-round" aria-current="${() => (((ui.sel.kind === "round" && ui.sel.id === r.id) || (ui.sel.kind === "question" && r.questions.some((q) => q.id === ui.sel.id))) ? "true" : false)}"
        @click="${(/** @type {Event} */ e) => { e.preventDefault(); select("round", r.id); }}"><span class="b-n">${i + 1}</span><span class="b-t">${() => r.title.trim() || `Round ${i + 1}`}</span><span class="b-c">${() => String(r.questions.length)}</span></a>
    </li>`.key(`${r.id}:${i}`);

  const roundsOutline = () => html`<div>
    <p class="label b-side-label">Rounds</p>
    <ul class="b-outline">
      ${() => d().rounds.map(outlineRound)}
    </ul>
    ${() => (d().rounds.length < 20 ? html`<a href="#" class="b-add" @click="${(/** @type {Event} */ e) => { e.preventDefault(); addRound(); }}">+ Add round</a>` : "")}
  </div>`;

  /** The outline is the Rounds tab's only; Sudden death and Settings are one page each (UI-57). */
  const outline = () => roundsOutline();

  /** Closes the "What needs fixing" popover and goes to the problem. @param {Event} e @param {string} path */
  const fixIt = (e, path) => {
    e.preventDefault();
    const pop = document.querySelector(".fix-pop");
    if (pop) pop.removeAttribute("open");
    goTo(path);
  };

  /** Opens the header's "What needs fixing" popover (from the Settings tab's Ready row). */
  const openFixes = (/** @type {Event} */ e) => {
    e.stopPropagation();   // the same click would otherwise reach the "click outside closes it" handler (nav.js)
    const pop = document.querySelector(".fix-pop");
    if (pop) { pop.setAttribute("open", ""); window.scrollTo({ top: 0 }); }
  };

  /** Not ready: the warning pill opens "What needs fixing" (design system: Popover), each line going
   *  to the part of the quiz it is about (UI-43). The list lives here, not on the Settings tab. */
  const readyPill = () => html`<span class="pill ok" hidden="${() => !ui.ready}"><i></i>Ready</span>
    <details class="problems fix-pop" hidden="${() => ui.ready}">
      <summary class="pill warn as-btn"><i></i>${() => readinessLabel(ui.ready, ui.problems)} ▾</summary>
      <div class="menu popover" role="dialog" aria-label="What needs fixing">
        <p class="pop-title">What needs fixing</p>
        <ul>${() => groupProblems(ui.problems).slice(0, 40).map((p) => html`<li><a href="#" @click="${(/** @type {Event} */ e) => fixIt(e, p.path)}">${p.message}</a></li>`)}</ul>
        <p class="muted s" hidden="${() => groupProblems(ui.problems).length <= 40}">${() => `And ${groupProblems(ui.problems).length - 40} more.`}</p>
      </div>
    </details>`;

  const head = () => html`<div class="page-head b-head">
    <div class="b-head-l">
      <a class="b-back" href="/host/build">← Quizzes</a>
      <h1>${() => d().title || "Untitled quiz"}</h1>
      <div class="row b-pills">${readyPill()} ${() => statusPill()}</div>
    </div>
    <div class="seg" role="tablist" aria-label="Quiz">${TABS.map(([id, label]) => html`
      <button type="button" role="tab" aria-selected="${() => String(tab() === id)}" @click="${() => showTab(id)}">${label}</button>`)}
    </div>
  </div>`;

  // ---- Editors (right column) -----------------------------------------------
  /**
   * @param {string} label
   * @param {readonly (readonly [string, string])[]} options [value, label]
   * @param {() => unknown} get
   * @param {(v: string) => void} set
   */
  const seg = (label, options, get, set) => html`
    <div class="seg" role="radiogroup" aria-label="${label}">
      ${options.map(([v, text]) => html`<button type="button" role="radio" aria-checked="${() => (String(get()) === v ? "true" : "false")}"
        @click="${() => set(v)}">${text}</button>`)}
    </div>`;

  /** @param {number} n @param {number} max */
  const count = (n, max) => `${n} of ${max} characters.`;

  /** The Settings tab: settings cards with the label on the left and the control on the right,
   *  as in the design canvas's builder (UI-31). Each control's hint sits under it. */
  const quizEditor = () => html`<div class="b-pane b-settings">
    <section class="card form-card cols">
      <h2>Quiz</h2>
      <div class="field">
        <label class="l" for="quiz-title">Quiz title</label>
        <div class="ctl"><input id="quiz-title" class="input" maxlength="80" spellcheck="true" autocomplete="off"
          value="${() => d().title}" @input="${(/** @type {Event} */ e) => { d().title = val(e); }}">
        <p class="hint">Renaming changes the title the teams see, not the quiz's folder name (${d().id}).</p></div>
      </div>
      <div class="field"><span class="l">Ready to run</span>
        <div class="ctl readiness">
          <p class="hint" hidden="${() => !ui.ready}"><span class="pill ok"><i></i>Ready</span> Every round has questions and every question has an answer.</p>
          <p class="hint" hidden="${() => ui.ready}"><span class="pill warn"><i></i>${() => readinessLabel(ui.ready, ui.problems)}</span> This quiz can't open a night yet.
            <button type="button" class="link" @click="${openFixes}">See what needs fixing</button></p>
        </div></div>
    </section>
    <section class="card form-card cols">
      <h2>Answers</h2>
      <div class="field"><span class="l">Lock answers</span>
        <div class="ctl">${seg("Lock answers", [["question", "After each question"], ["round", "At the end of each round"]], () => d().settings.lockMode, (v) => { d().settings.lockMode = /** @type {any} */ (v); })}</div></div>
      <div class="field"><label class="l" for="set-timer">Timer per question</label>
        <div class="ctl"><div class="unit"><input id="set-timer" class="input short" type="number" min="10" max="300" step="5" value="${() => d().settings.timerSeconds}"
          @input="${(/** @type {Event} */ e) => { const n = num(val(e)); if (n !== null) d().settings.timerSeconds = n; }}"><span>seconds</span></div>
        <p class="hint">10 to 300. A question can set its own.</p></div></div>
    </section>
    <section class="card form-card cols">
      <h2>Rounds and teams</h2>
      <div class="field"><label class="l" for="set-half">Halftime</label>
        <div class="ctl"><select id="set-half" class="input narrow" @change="${(/** @type {Event} */ e) => { const v = val(e); d().settings.halftimeAfterRound = v === "auto" || v === "none" ? v : Number(v); }}">
          ${() => [
            html`<option value="auto" selected="${() => d().settings.halftimeAfterRound === "auto"}">Halfway (after round ${Math.ceil(d().rounds.length / 2)})</option>`,
            html`<option value="none" selected="${() => d().settings.halftimeAfterRound === "none"}">No halftime</option>`,
            ...d().rounds.slice(0, -1).map((_, i) => html`<option value="${String(i + 1)}" selected="${() => d().settings.halftimeAfterRound === i + 1}">After round ${i + 1}</option>`),
          ]}
        </select></div></div>
      <div class="field"><span class="l">Joker</span>
        <div class="ctl">${seg("Joker", [["false", "Off"], ["true", "On"]], () => d().settings.joker, (v) => { d().settings.joker = v === "true"; })}
        <p class="hint">Each team picks one round to score double.</p></div></div>
      <div class="field"><label class="l" for="set-teams">Team limit</label>
        <div class="ctl"><div class="unit"><input id="set-teams" class="input short" type="number" min="2" max="30" value="${() => d().settings.maxTeams}"
          @input="${(/** @type {Event} */ e) => { const n = num(val(e)); if (n !== null) d().settings.maxTeams = n; }}"><span>teams</span></div>
        <p class="hint">2 to 30. Joining closes when the quiz is full.</p></div></div>
    </section>
    <section class="card form-card cols">
      <h2>Ties and closest numbers</h2>
      <div class="field"><span class="l">Closest-number scoring</span>
        <div class="ctl">${seg("Closest-number scoring", [["closest", "Closest team wins"], ["range", "Everyone within range"]], () => d().settings.closestScoring, (v) => { d().settings.closestScoring = /** @type {any} */ (v); })}</div></div>
      <div class="field"><span class="l">Sudden death decides</span>
        <div class="ctl">${seg("Sudden death decides", [["first", "First place only"], ["all", "Every tied place"]], () => d().settings.suddenDeathScope, (v) => { d().settings.suddenDeathScope = /** @type {any} */ (v); })}</div></div>
      <div class="field"><label class="l" for="set-sdmax">Sudden-death questions</label>
        <div class="ctl"><div class="unit"><input id="set-sdmax" class="input short" type="number" min="1" max="10" value="${() => d().settings.suddenDeathMax}"
          @input="${(/** @type {Event} */ e) => { const n = num(val(e)); if (n !== null) d().settings.suddenDeathMax = n; }}"><span>per place, at most</span></div>
        <p class="hint">1 to 10. After that the place is shared.</p></div></div>
    </section>
  </div>`;

  const roundsEmpty = () => html`<div class="b-pane">
    <p class="muted">This quiz has no rounds yet.</p>
    <button type="button" class="btn primary" @click="${() => addRound()}">+ Add round</button></div>`;

  /** @param {Round} r */
  const roundEditor = (r) => {
    const i = roundIndex(r.id);
    const rounds = d().rounds;
    return html`<div class="b-pane">
      <div class="row between">
        <h1>Round ${i + 1}</h1>
        <div class="row">
          <button type="button" class="btn ghost" aria-label="Move round up" disabled="${i === 0}" @click="${() => move(rounds, roundIndex(r.id), -1)}">↑</button>
          <button type="button" class="btn ghost" aria-label="Move round down" disabled="${i === rounds.length - 1}" @click="${() => move(rounds, roundIndex(r.id), 1)}">↓</button>
          <button type="button" class="btn danger" @click="${() => deleteRound(r.id)}">Delete round</button>
        </div>
      </div>
      <div class="field">
        <label class="l" for="round-title">Round title</label>
        <input id="round-title" class="input" maxlength="60" spellcheck="true" autocomplete="off" placeholder="${`Round ${i + 1}`}"
          value="${() => r.title}" @input="${(/** @type {Event} */ e) => { r.title = val(e); }}">
        <p class="muted s">Shown on the display when the round starts. ${() => count([...r.title].length, 60)}</p>
      </div>
      <h2>Questions</h2>
      <ol class="q-list">${() => r.questions.map((q) => html`<li><a href="#" @click="${(/** @type {Event} */ e) => { e.preventDefault(); select("question", q.id); }}">${() => q.text.trim() || "No question text yet"}</a></li>`.key(q.id))}</ol>
      ${() => (r.questions.length < 30
        ? html`<button type="button" class="btn ghost" @click="${() => addQuestion(r.questions, 30, false)}">+ Add question</button>`
        : html`<p class="muted s">A round can have at most 30 questions.</p>`)}</div>`;
  };

  const sdEditor = () => html`<div class="b-pane">
    <div class="row between"><h1>Sudden death</h1></div>
    <p class="muted">Used only when teams are still tied after the tie breaker (most round wins). The tied teams answer one question at a time; right beats wrong. Typed answers, multiple choice and closest number only.</p>
    <ol class="q-list">${() => d().suddenDeath.map((q) => html`<li><a href="#" @click="${(/** @type {Event} */ e) => { e.preventDefault(); select("question", q.id); }}">${() => q.text.trim() || "No question text yet"}</a></li>`.key(q.id))}</ol>
    ${() => (d().suddenDeath.length < 20
      ? html`<button type="button" class="btn ghost" @click="${() => addQuestion(d().suddenDeath, 20, true)}">+ Add sudden-death question</button>`
      : html`<p class="muted s">A quiz can have at most 20 sudden-death questions.</p>`)}</div>`;

  /** @param {Question} q */
  const textAnswer = (q) => {
    const a = /** @type {{ type: "text", accepted: string[] }} */ (q.answer);
    const addAccepted = () => {
      const t = ui.accept.trim();
      if (t === "" || a.accepted.length >= 50) return;
      if (!a.accepted.some((x) => x.trim().toLowerCase() === t.toLowerCase())) a.accepted.push(t);
      ui.accept = "";
    };
    return html`<div class="b-pane">
      <div class="field"><label class="l" for="ans-text">Correct answer</label>
        <input id="ans-text" class="input" maxlength="100" spellcheck="true" autocomplete="off"
          value="${() => a.accepted[0] ?? ""}" @input="${(/** @type {Event} */ e) => { if (a.accepted.length === 0) a.accepted.push(val(e)); else a.accepted[0] = val(e); }}">
        <p class="muted s">Shown at the reveal. Typed answers are matched ignoring capitals, accents and punctuation.</p></div>
      <div class="field"><span class="l">Also accept</span>
        <div class="chips">
          ${() => a.accepted.slice(1).map((t, k) => html`<span class="chip">${t}<button type="button" aria-label="${`Stop accepting ${t}`}" @click="${() => a.accepted.splice(k + 1, 1)}">×</button></span>`)}
          <input class="input chip-input" maxlength="100" spellcheck="true" autocomplete="off" placeholder="Another answer, then Enter" aria-label="Another accepted answer"
            value="${() => ui.accept}" @input="${(/** @type {Event} */ e) => { ui.accept = val(e); }}"
            @keydown="${(/** @type {Event} */ e) => { if (/** @type {KeyboardEvent} */ (e).key === "Enter") { e.preventDefault(); addAccepted(); } }}">
          <button type="button" class="btn ghost" @click="${addAccepted}">+ Add</button>
        </div>
        <p class="muted s">You can also accept answers while marking. They are saved here.</p></div></div>`;
  };

  /** @param {Question} q */
  const choiceAnswer = (q) => {
    const a = /** @type {{ type: "choice", options: string[], correct: number }} */ (q.answer);
    return html`
      <div class="field"><span class="l">Options (pick the correct one)</span>
        <ol class="options">${() => a.options.map((_, k) => html`
          <li>
            <label class="radio"><input type="radio" name="${`correct-${q.id}`}" checked="${() => a.correct === k}" @change="${() => { a.correct = k; }}">
              <span class="visually-hidden">${`Option ${String.fromCharCode(65 + k)} is correct`}</span></label>
            <span class="opt-letter">${String.fromCharCode(65 + k)}</span>
            <input class="input" maxlength="100" spellcheck="true" autocomplete="off" aria-label="${`Option ${String.fromCharCode(65 + k)}`}"
              value="${() => a.options[k] ?? ""}" @input="${(/** @type {Event} */ e) => { a.options[k] = val(e); }}">
            <button type="button" class="btn ghost" aria-label="${`Remove option ${String.fromCharCode(65 + k)}`}" disabled="${() => a.options.length <= 2}"
              @click="${() => { a.options.splice(k, 1); if (a.correct === k) a.correct = -1; else if (a.correct > k) a.correct--; }}">×</button>
          </li>`)}</ol>
        ${() => (a.options.length < 6 ? html`<button type="button" class="btn ghost" @click="${() => a.options.push("")}">+ Add option</button>` : html`<p class="muted s">At most 6 options.</p>`)}
      </div>`;
  };

  /** @param {{ range?: number }} a @param {string} unit */
  const rangeField = (a, unit) => html`
    <div class="field"><label class="l" for="ans-range">Within range (${unit})</label>
      <input id="ans-range" class="input narrow" type="number" min="0" step="any" value="${() => a.range ?? ""}"
        @input="${(/** @type {Event} */ e) => { const n = num(val(e)); a.range = n === null || n < 0 ? undefined : n; }}">
      <p class="muted s">With “Everyone within range” scoring, every team this close or closer scores.</p></div>`;

  /** @param {Question} q */
  const numberAnswer = (q) => {
    const a = /** @type {{ type: "number" | "closest", value: number | null, range?: number }} */ (q.answer);
    return html`<div class="b-pane">
      <div class="field"><label class="l" for="ans-num">${a.type === "number" ? "Correct number" : "The real number"}</label>
        <input id="ans-num" class="input narrow" type="number" step="any" value="${() => (a.value ?? "")}"
          @input="${(/** @type {Event} */ e) => { a.value = num(val(e)); }}">
        <p class="muted s">${a.type === "number" ? "Marked right or wrong, exactly." : "The closest team scores (see Closest-number scoring in the quiz settings)."}</p></div>
      ${() => (a.type === "closest" && d().settings.closestScoring === "range" ? rangeField(a, "same unit as the answer") : "")}</div>`;
  };

  /** @param {Question} q */
  const datetimeAnswer = (q) => {
    const a = /** @type {{ type: "datetime", precision: "year" | "date" | "time", value: string, scoring: "exact" | "closest", range?: number }} */ (q.answer);
    const unit = () => ({ year: "years", date: "days", time: "minutes" })[a.precision];
    return html`<div class="b-pane">
      <div class="row wrap">
        <div class="field"><span class="l">The answer is a</span>
          ${seg("Answer is a", [["year", "Year"], ["date", "Date"], ["time", "Time of day"]], () => a.precision, (v) => { if (a.precision !== v) { a.precision = /** @type {any} */ (v); a.value = ""; } })}</div>
        <div class="field"><span class="l">Marking</span>
          ${seg("Marking", [["exact", "Exact"], ["closest", "Closest"]], () => a.scoring, (v) => { a.scoring = /** @type {any} */ (v); })}</div>
      </div>
      ${() => {
        const p = a.precision;
        const input = p === "year"
          ? html`<input id="ans-dt" class="input narrow" inputmode="numeric" maxlength="5" placeholder="1969" value="${() => a.value}" @input="${(/** @type {Event} */ e) => { a.value = val(e).trim(); }}">`
          : p === "date"
            ? html`<input id="ans-dt" class="input narrow" type="date" value="${() => a.value}" @input="${(/** @type {Event} */ e) => { a.value = val(e); }}">`
            : html`<input id="ans-dt" class="input narrow" type="time" value="${() => a.value}" @input="${(/** @type {Event} */ e) => { a.value = val(e); }}">`;
        return html`<div class="field"><label class="l" for="ans-dt">Correct ${p === "time" ? "time" : p}</label>${input}
          <p class="muted s">${p === "year" ? "A year like 1969." : p === "date" ? "Teams pick a date on their phones." : "Teams pick a time of day, like 20:17."}</p></div>`;
      }}
      ${() => (a.scoring === "closest" && d().settings.closestScoring === "range" ? rangeField(a, unit()) : "")}</div>`;
  };

  /** @param {Question} q */
  const answerEditor = (q) => {
    const t = q.answer.type;
    if (t === "text") return textAnswer(q);
    if (t === "choice") return choiceAnswer(q);
    if (t === "number" || t === "closest") return numberAnswer(q);
    if (t === "datetime") return datetimeAnswer(q);
    return html`<p class="banner warn">This question uses the answer type “${t}”, which this version of Lock-In can't edit or mark. Pick another type above, or keep it for a newer version.</p>`;
  };

  /** @param {Question} q */
  const mediaEditor = (q) => html`
    <div class="field"><span class="l">Picture</span>
      ${() => (q.media && q.media.kind === "image"
        ? html`<div class="picture">
            <img src="${() => (q.media ? `/media/quiz/${encodeURIComponent(d().id)}/${encodeURIComponent(q.media.file)}` : "")}" alt="${() => (q.media && q.media.alt) || "The question's picture"}">
            <div class="picture-side">
              <label class="l" for="img-alt">Description (for screen readers)</label>
              <input id="img-alt" class="input" maxlength="300" spellcheck="true" autocomplete="off" value="${() => (q.media && q.media.alt) || ""}"
                @input="${(/** @type {Event} */ e) => { if (q.media) { const v = val(e); q.media = v ? { kind: "image", file: q.media.file, alt: v } : { kind: "image", file: q.media.file }; } }}">
              <div class="row">
                <label class="btn ghost file-btn">Replace<input type="file" accept="image/jpeg,image/png,image/webp" @change="${(/** @type {Event} */ e) => pickImage(q, e)}"></label>
                <button type="button" class="btn ghost" @click="${() => { q.media = undefined; }}">Remove picture</button>
              </div>
            </div>
          </div>`
        : q.media
          ? html`<p class="muted s">This question has ${q.media.kind} media, which this version of Lock-In can't show. <button type="button" class="btn ghost" @click="${() => { q.media = undefined; }}">Remove it</button></p>`
          : html`<label class="btn ghost file-btn">Add a picture<input type="file" accept="image/jpeg,image/png,image/webp" @change="${(/** @type {Event} */ e) => pickImage(q, e)}"></label>`)}
      <p class="muted s busy-line" hidden="${() => !ui.uploading}">${spinner()}Resizing and uploading the picture</p>
      <p class="form-error" role="alert" hidden="${() => !ui.uploadError}">${() => ui.uploadError}</p>
    </div>`;

  /** @param {Question} q */
  const questionEditor = (q) => {
    const f = /** @type {NonNullable<ReturnType<typeof findQuestion>>} */ (findQuestion(q.id));
    /** Live, so a move up or down renumbers it. */
    const heading = () => {
      const g = findQuestion(q.id);
      if (!g) return "";
      return g.sd ? `Sudden death · Question ${g.i + 1}` : `Round ${g.round + 1} · Question ${g.i + 1}`;
    };
    /** Back to the list the question is in: its round, or Sudden death (UI-57, questions left the outline). */
    const back = () => {
      const g = findQuestion(q.id);
      if (!g) return;
      if (g.sd) select("sd");
      else select("round", /** @type {Round} */ (d().rounds[g.round]).id);
    };
    const backLabel = () => {
      const g = findQuestion(q.id);
      if (!g) return "";
      if (g.sd) return "← Sudden death";
      const r = /** @type {Round} */ (d().rounds[g.round]);
      return `← ${r.title.trim() || `Round ${g.round + 1}`}`;
    };
    const types = f.sd ? ANSWER_TYPES.filter(([v]) => SD_TYPES.includes(v)) : ANSWER_TYPES;
    return html`<div class="b-pane">
      <a href="#" class="b-back" @click="${(/** @type {Event} */ e) => { e.preventDefault(); back(); }}">${backLabel}</a>
      <div class="row between">
        <h1>${heading}</h1>
        <div class="row">
          <button type="button" class="btn ghost" aria-label="Move question up" disabled="${f.i === 0}" @click="${() => { const g = findQuestion(q.id); if (g) move(g.list, g.i, -1); }}">↑</button>
          <button type="button" class="btn ghost" aria-label="Move question down" disabled="${f.i === f.list.length - 1}" @click="${() => { const g = findQuestion(q.id); if (g) move(g.list, g.i, 1); }}">↓</button>
          <button type="button" class="btn danger" @click="${() => deleteQuestion(q.id)}">Delete</button>
        </div>
      </div>
      <div class="field">
        <label class="l" for="q-text">Question</label>
        <textarea id="q-text" class="input" rows="3" maxlength="300" spellcheck="true" lang="${document.documentElement.lang || "en"}"
          value="${() => q.text}" @input="${(/** @type {Event} */ e) => { q.text = val(e); }}"></textarea>
        <p class="muted s">${() => count([...q.text].length, 300)} Spelling mistakes are underlined as you type.</p>
      </div>
      <div class="row wrap top">
        <div class="field"><span class="l">Answer type</span>
          ${seg("Answer type", types, () => q.answer.type, (v) => setType(q, v))}</div>
        <div class="field"><span class="l">Timer</span>
          <div class="row">
            ${seg("Timer", [["default", `Quiz default (${d().settings.timerSeconds} s)`], ["custom", "Custom"]],
              () => (q.timerSeconds === undefined ? "default" : "custom"),
              (v) => { q.timerSeconds = v === "custom" ? (q.timerSeconds ?? d().settings.timerSeconds) : undefined; })}
            ${() => (q.timerSeconds === undefined ? "" : html`<input class="input tiny" type="number" min="10" max="300" step="5" aria-label="Seconds for this question"
              value="${() => q.timerSeconds ?? ""}" @input="${(/** @type {Event} */ e) => { const n = num(val(e)); if (n !== null) q.timerSeconds = n; }}"> <span class="muted s">s</span>`)}
          </div></div>
      </div>
      ${f.sd ? "" : mediaEditor(q)}
      ${() => answerEditor(q)}
      <div class="field">
        <label class="l" for="q-note">Note for the host (not shown to teams)</label>
        <input id="q-note" class="input" maxlength="300" spellcheck="true" autocomplete="off" placeholder="A pronunciation, a source, a fun fact"
          value="${() => q.note ?? ""}" @input="${(/** @type {Event} */ e) => { const v = val(e); q.note = v === "" ? undefined : v; }}">
      </div></div>`;
  };

  /** Picks the editor from the selection. Reads only structure (ids, order), never typed text, so typing never rebuilds it. */
  const editor = () => {
    const sel = ui.sel;
    if (sel.kind === "round") {
      const i = roundIndex(sel.id);
      if (i >= 0) return roundEditor(/** @type {Round} */ (d().rounds[i]));
    }
    if (sel.kind === "question") {
      const f = findQuestion(sel.id);
      if (f) return questionEditor(f.q);
    }
    if (sel.kind === "sd") return sdEditor();
    if (sel.kind === "none") return "";
    if (sel.kind === "rounds") return d().rounds[0] ? roundEditor(/** @type {Round} */ (d().rounds[0])) : roundsEmpty();
    return quizEditor();
  };

  // ---- Page -------------------------------------------------------------------
  html`${() => {
    if (ui.phase === "loading") return html`<div class="b-loading">${loading("Opening the quiz")}</div>`;
    if (ui.phase === "missing") {
      return html`<div class="b-missing"><a class="b-back" href="/host/build">← Quizzes</a><h1>Can't open this quiz</h1><p>${() => ui.message}</p></div>`;
    }
    return html`<div class="b-page">${head()}<div class="${() => (tab() !== "rounds" ? "builder no-side" : "builder")}">
      <nav class="b-side" aria-label="Rounds" hidden="${() => tab() !== "rounds"}">${outline()}</nav>
      <main class="b-editor">
        ${() => banner()}
        <fieldset class="b-fields" disabled="${() => ui.status === "locked" || ui.status === "conflict"}">
          ${() => editor()}
        </fieldset>
      </main>
    </div></div>`;
  }}`(root);

  document.body.classList.add("builder-open");

  getQuiz(quizId).then((res) => {
    lastSent = JSON.stringify(res.quiz);
    ui.base = res.quiz.updatedAt;
    ui.ready = res.ready;
    ui.problems = res.problems;
    ui.draft = res.quiz;
    ui.status = "saved";
    ui.phase = "open";
    const first = res.quiz.rounds[0];
    ui.sel = first ? { kind: "round", id: first.id } : { kind: "rounds", id: "" };
    document.title = `${res.quiz.title} · Lock-In host`;
  }, (e) => {
    ui.message = e instanceof Error ? e.message : String(e);
    ui.phase = "missing";
  });
}
