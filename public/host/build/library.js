// @ts-check
// Quiz library (H-01): list, create, open, duplicate, rename and delete quizzes.
import { html, nextTick, reactive } from "/vendor/arrow/index.mjs";
import { ApiError, createQuiz, deleteQuiz, duplicateQuiz, getQuiz, groupProblems, listQuizzes, readinessLabel, saveQuiz, whenEdited } from "./api.js";

/** @typedef {import("./api.js").QuizSummary} QuizSummary */

/**
 * The open dialog, if any: what it does, the quiz it acts on and its text field.
 * @typedef {{ kind: "new" | "rename" | "duplicate" | "delete", quiz: QuizSummary | null, title: string, busy: boolean, error: string }} Dialog
 */

/** @param {HTMLElement} root */
export function mountLibrary(root) {
  const page = reactive({
    quizzes: /** @type {QuizSummary[] | null} */ (null),
    error: "",
    /** id of the row whose ⋯ menu is open */
    menu: /** @type {string | null} */ (null),
  });
  // Local UI state, apart from the server's list (TECH-SPEC 3.4).
  const ui = reactive({ dialog: /** @type {Dialog | null} */ (null) });

  async function load() {
    try {
      const list = await listQuizzes();
      // A fresh table, so no row's chunk is reused for another quiz (see builder.js select()).
      page.quizzes = null;
      await nextTick();
      page.quizzes = list;
      page.error = "";
    } catch (e) {
      page.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** @param {Dialog["kind"]} kind @param {QuizSummary | null} quiz */
  function openDialog(kind, quiz) {
    page.menu = null;
    const title = kind === "rename" && quiz ? quiz.title : kind === "duplicate" && quiz ? `${quiz.title.slice(0, 73)} (copy)` : "";
    ui.dialog = { kind, quiz, title, busy: false, error: "" };
    requestAnimationFrame(() => {
      const d = /** @type {HTMLDialogElement | null} */ (root.querySelector("dialog"));
      if (d && !d.open) d.showModal();
      const input = /** @type {HTMLInputElement | null} */ (root.querySelector("dialog input"));
      if (input) { input.focus(); input.select(); }
    });
  }

  function closeDialog() {
    const d = /** @type {HTMLDialogElement | null} */ (root.querySelector("dialog"));
    if (d && d.open) d.close();
    ui.dialog = null;
  }

  /** @param {Event} e */
  async function submitDialog(e) {
    e.preventDefault();
    const d = ui.dialog;
    if (!d || d.busy) return;
    const title = d.title.trim();
    if (d.kind !== "delete" && title === "") { d.error = "Give the quiz a title."; return; }
    d.busy = true;
    d.error = "";
    try {
      if (d.kind === "new") {
        const quiz = await createQuiz(title);
        location.href = `/host/build?quiz=${encodeURIComponent(quiz.id)}`;
        return;
      }
      const q = /** @type {QuizSummary} */ (d.quiz);
      if (d.kind === "duplicate") await duplicateQuiz(q.id, title);
      if (d.kind === "delete") await deleteQuiz(q.id);
      if (d.kind === "rename") {
        const { quiz } = await getQuiz(q.id);
        quiz.title = title;
        await saveQuiz(quiz, quiz.updatedAt);
      }
      closeDialog();
      await load();
    } catch (err) {
      d.busy = false;
      d.error = err instanceof ApiError || err instanceof Error ? err.message : String(err);
    }
  }

  /** @param {QuizSummary} q */
  const roundsLabel = (q) => {
    if (q.rounds === 0) return "No rounds";
    return q.questions % q.rounds === 0 ? `${q.rounds} × ${q.questions / q.rounds}` : `${q.rounds} rounds, ${q.questions} questions`;
  };

  /** @param {QuizSummary} q */
  const row = (q) => html`
    <tr class="${q.ready ? "ready" : "not-ready"}">
      <td class="lib-title">
        <span class="${q.ready ? "sdot ok" : "sdot warn"}" aria-hidden="true"></span>
        <span class="lib-name"><a href="${`/host/build?quiz=${encodeURIComponent(q.id)}`}">${q.title}</a>
          <span class="lib-meta">${roundsLabel(q)} · ${q.questions} ${q.questions === 1 ? "question" : "questions"}</span></span>
      </td>
      <td class="lib-edited">${whenEdited(q.updatedAt)}</td>
      <td class="lib-status">${q.ready
        ? html`<a class="go" href="${`/host/run?quiz=${encodeURIComponent(q.id)}`}">Open night →</a>`
        : html`<details class="problems">
            <summary>${readinessLabel(q.ready, q.problems)} ▾</summary>
            <div class="menu popover" role="dialog" aria-label="What needs fixing">
              <p class="pop-title">What needs fixing</p>
              <ul>${groupProblems(q.problems).slice(0, 8).map((p) => html`<li>${p.message}</li>`)}</ul>
              ${groupProblems(q.problems).length > 8 ? html`<p class="muted s">And ${groupProblems(q.problems).length - 8} more. Open the quiz to see them all.</p>` : ""}
              <a class="go" href="${`/host/build?quiz=${encodeURIComponent(q.id)}`}">Open the quiz to fix them →</a>
            </div>
          </details>`}</td>
      <td class="lib-actions">
        <a class="btn small" href="${`/host/build?quiz=${encodeURIComponent(q.id)}`}">Edit</a>
        <span class="menu-wrap">
          <button type="button" class="btn more" aria-haspopup="menu" aria-label="${`More for ${q.title}`}"
            aria-expanded="${() => (page.menu === q.id ? "true" : "false")}"
            @click="${() => { page.menu = page.menu === q.id ? null : q.id; }}">⋯</button>
          <span class="menu" role="menu" hidden="${() => page.menu !== q.id}">
            <button type="button" role="menuitem" @click="${() => openDialog("duplicate", q)}">Duplicate</button>
            <button type="button" role="menuitem" @click="${() => openDialog("rename", q)}">Rename</button>
            <hr>
            <button type="button" role="menuitem" class="danger-text" @click="${() => openDialog("delete", q)}">Delete…</button>
          </span>
        </span>
      </td>
    </tr>`.key(`${q.id}@${q.updatedAt}`);

  const dialogBody = () => {
    const d = ui.dialog;
    if (!d) return "";
    const heading = { new: "New quiz", rename: "Rename quiz", duplicate: "Duplicate quiz", delete: "Delete this quiz?" }[d.kind];
    const action = { new: "Create", rename: "Rename", duplicate: "Duplicate", delete: "Delete" }[d.kind];
    return html`
      <form method="dialog" @submit="${submitDialog}">
        <h2>${heading}</h2>
        ${d.kind === "delete"
          ? html`<p>“${d.quiz ? d.quiz.title : ""}” moves to the data folder's trash (<code>quizzes/.trash/</code>), so whoever runs the server can still get it back.</p>`
          : html`<label class="l" for="dlg-title">Title</label>
              <input id="dlg-title" class="input" maxlength="80" spellcheck="true" autocomplete="off"
                value="${() => (ui.dialog ? ui.dialog.title : "")}"
                @input="${(/** @type {Event} */ e) => { if (ui.dialog) ui.dialog.title = /** @type {HTMLInputElement} */ (e.target).value; }}">
              ${d.kind === "new" ? html`<p class="muted s">It starts with 6 rounds of 5 questions and the usual settings. You can change both.</p>` : ""}`}
        <p class="form-error" role="alert" hidden="${() => !(ui.dialog && ui.dialog.error)}">${() => (ui.dialog ? ui.dialog.error : "")}</p>
        <div class="row end">
          <button type="button" class="btn ghost" @click="${closeDialog}">Cancel</button>
          <button type="submit" class="${d.kind === "delete" ? "btn danger" : "btn primary"}" disabled="${() => !!(ui.dialog && ui.dialog.busy)}">${action}</button>
        </div>
      </form>`;
  };

  html`
    <div class="lib-head">
      <h1>Quizzes <span class="count-dim">${() => (page.quizzes ? String(page.quizzes.length) : "")}</span></h1>
      <button type="button" class="btn primary" @click="${() => openDialog("new", null)}">New quiz</button>
    </div>
    <p class="form-error" role="alert" hidden="${() => !page.error}">${() => page.error}</p>
    ${() => (page.quizzes === null ? html`<p class="muted">Loading quizzes…</p>`
      : page.quizzes.length === 0 ? html`<div class="empty"><p>No quizzes yet.</p><p class="muted">Make one with “New quiz”, or copy a quiz folder into the data folder's <code>quizzes/</code> folder.</p></div>`
      : html`<table class="lib">
          <thead><tr><th>Quiz</th><th>Edited</th><th>Status</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody>${() => (page.quizzes || []).map(row)}</tbody>
        </table>`)}
    <p class="muted s">A quiz that is not ready can't open a night. Duplicate, rename and delete are under ⋯. Delete asks first.</p>
    <dialog class="dlg" @close="${() => { ui.dialog = null; }}">${() => dialogBody()}</dialog>
  `(root);

  document.addEventListener("click", (e) => {
    if (page.menu && !(e.target instanceof Element && e.target.closest(".menu-wrap"))) page.menu = null;
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") page.menu = null; });
  load();
}
