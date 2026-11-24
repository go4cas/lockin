// @ts-check
// The console's two stores (TECH-SPEC 3.4): `page` holds the server's view, `ui` the
// console's own short-lived state (open dialog, typed text, busy buttons), so a new
// view never closes a dialog or clears a field the host is typing in.
import { reactive } from "/vendor/arrow/index.mjs";
import { can } from "./logic.js";

/** @typedef {import("../../../src/shared/protocol").HostView} HostView */
/** @typedef {import("../../../src/shared/protocol").CommandName} CommandName */

export const page = reactive({
  /** @type {HostView | null} */ view: /** @type {any} */ (null),
  /** Changes only when the phase changes, so whole screens are built once per phase. */
  screen: "loading",
  /** "connecting" | "online" | "offline" */
  status: "connecting",
  /** Server time, ticked four times a second for timers. */
  now: Date.now(),
});

export const ui = reactive({
  /** Commands waiting for their ack: name -> true. */
  busy: /** @type {Record<string, boolean>} */ ({}),
  /** Last error from a command or a fetch, shown in a bar until closed. */
  error: "",
  /** The open dialog, or "" for none. */
  dialog: "",
  /** Everything the open dialog needs; never part of page.view. */
  d: /** @type {Record<string, any>} */ ({}),
  /** Marking: the question the host picked. */
  markQ: "",
  /** Lobby: planned start being typed. */
  planned: "",
  plannedDirty: false,
  /** Server info for the display address (B8's /api/server). */
  displayUrl: "",
});

/** @type {any} */
let client = null;

/** @param {any} c */
export function setClient(c) {
  client = c;
}

/** The server's time now, as this console best knows it. */
export function serverNow() {
  return client ? client.clock.now() : Date.now();
}

/**
 * Is this command's button usable now? Allowed by the server, online, and not already waiting for an ack.
 * @param {CommandName} name
 */
export function enabled(name) {
  return page.status === "online" && !ui.busy[name] && can(/** @type {HostView} */ (page.view), name);
}

/**
 * Sends a host command. At most one pending command per name (10.5). Resolves with
 * { ok: true, result } or, after showing the server's plain-English message, { ok: false }.
 * @param {CommandName} name
 * @param {object} [args]
 * @returns {Promise<{ ok: boolean, result?: any }>}
 */
export async function send(name, args) {
  if (!client || ui.busy[name]) return { ok: false };
  ui.busy[name] = true;
  ui.error = "";
  try {
    return { ok: true, result: await client.cmd(name, args || {}) };
  } catch (e) {
    const err = /** @type {any} */ (e);
    ui.error = (err && err.message) || "That did not work. Try again.";
    return { ok: false };
  } finally {
    ui.busy[name] = false;
  }
}

/**
 * Opens a dialog with its own data.
 * @param {string} name
 * @param {Record<string, any>} [data]
 */
export function openDialog(name, data) {
  ui.d = data || {};
  ui.dialog = name;
}

export function closeDialog() {
  ui.dialog = "";
  ui.d = {};
}

/**
 * GET a host API route as JSON. Throws an Error with a plain-English message.
 * @param {string} url
 */
export async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
  } catch {
    throw new Error("Lock-In could not be reached. Check the connection and try again.");
  }
  if (res.status === 401) {
    location.href = `/host/login?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("Signed out.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.error && body.error.message) || "That could not be loaded. Try again.");
  return body;
}
