// @ts-check
// Quiz REST calls for the library and builder (TECH-SPEC 9.2).

/** @typedef {import("../../../src/shared/formats").QuizDraft} QuizDraft */
/** @typedef {import("../../../src/shared/formats").Problem} Problem */
/**
 * @typedef {{ id: string, title: string, rounds: number, questions: number, updatedAt: string,
 *   ready: boolean, problems: Problem[] }} QuizSummary
 */

/** An error from the server, with its code and plain-English message. */
export class ApiError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * True when a save failed because the server could not be reached, so the builder retries on a
 * timer. Decided by the stable code, never by the English message (code review LI-019).
 * @param {unknown} e
 */
export function isOffline(e) {
  return e instanceof ApiError && e.code === "offline";
}

/**
 * @param {string} method
 * @param {string} url
 * @param {unknown} [body] a JSON body, or FormData
 * @returns {Promise<any>}
 */
export async function call(method, url, body) {
  /** @type {RequestInit} */
  const init = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "offline", "Can't reach the server. Check the connection; your changes are kept here and will be saved when it's back.");
  }
  if (res.status === 401) {
    location.href = `/host/login?next=${encodeURIComponent("/host/build")}`;
    throw new ApiError(401, "signed_out", "Please sign in again.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const err = data && data.error;
    throw new ApiError(res.status, (err && err.code) || "server_error", (err && err.message) || "Something went wrong on the server. Try again.");
  }
  return data;
}

/** @returns {Promise<QuizSummary[]>} */
export const listQuizzes = async () => (await call("GET", "/api/quizzes")).quizzes;
/** @param {string} title @returns {Promise<QuizDraft>} */
export const createQuiz = async (title) => (await call("POST", "/api/quizzes", { title })).quiz;
/** @param {string} id @returns {Promise<{ quiz: QuizDraft, ready: boolean, problems: Problem[] }>} */
export const getQuiz = (id) => call("GET", `/api/quizzes/${encodeURIComponent(id)}`);
/** @param {QuizDraft} quiz @param {string} baseUpdatedAt @returns {Promise<{ quiz: QuizDraft, ready: boolean, problems: Problem[] }>} */
export const saveQuiz = (quiz, baseUpdatedAt) => call("PUT", `/api/quizzes/${encodeURIComponent(quiz.id)}`, { quiz, baseUpdatedAt });
/** @param {string} id @param {string} title @returns {Promise<QuizDraft>} */
export const duplicateQuiz = async (id, title) => (await call("POST", `/api/quizzes/${encodeURIComponent(id)}/duplicate`, { title })).quiz;
/** @param {string} id */
export const deleteQuiz = (id) => call("DELETE", `/api/quizzes/${encodeURIComponent(id)}`);

/**
 * @param {string} id
 * @param {string} questionId
 * @param {Blob} file
 * @param {string} name
 * @returns {Promise<string>} the stored file name
 */
export async function uploadImage(id, questionId, file, name) {
  const form = new FormData();
  form.set("questionId", questionId);
  form.set("file", file, name);
  return (await call("POST", `/api/quizzes/${encodeURIComponent(id)}/media`, form)).file;
}

/** "Today, 14:02", "Yesterday", "20 Nov" or "20 Nov 2025". @param {string} iso */
export function whenEdited(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const day = (/** @type {Date} */ x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A short readiness label: "Ready", "3 questions need work" or the first problem.
 * @param {boolean} ready
 * @param {Problem[]} problems
 */
export function readinessLabel(ready, problems) {
  if (ready) return "Ready";
  const questions = new Set();
  let other = 0;
  for (const p of problems) {
    const m = /^(rounds\.\d+\.questions\.\d+|suddenDeath\.\d+)/.exec(p.path);
    if (m) questions.add(m[1]);
    else other++;
  }
  if (other === 0 && questions.size > 0) return questions.size === 1 ? "1 question needs work" : `${questions.size} questions need work`;
  return problems.length === 1 ? "1 thing to fix" : `${problems.length} things to fix`;
}

/**
 * One line per question: a question with no text and no answer is "still empty"
 * rather than two lines.
 * @param {Problem[]} problems
 * @returns {Problem[]}
 */
export function groupProblems(problems) {
  /** @type {Problem[]} */
  const out = [];
  for (let i = 0; i < problems.length; i++) {
    const p = /** @type {Problem} */ (problems[i]);
    const next = problems[i + 1];
    const m = / has no question text\.$/.exec(p.message);
    if (m && next && next.message === p.message.replace(/ has no question text\.$/, " has no answer.")) {
      out.push({ path: p.path, message: p.message.replace(/ has no question text\.$/, " is still empty.") });
      i++;
    } else out.push(p);
  }
  return out;
}
