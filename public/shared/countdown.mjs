// @ts-check
// The Countdown (docs/DESIGN-SYSTEM.md, "Countdown"): one component, five looks (number,
// ring, solid bar, dashed bar, flip), chosen per venue in Branding and used on the TV, the
// phones and the host console. Normal: the venue colour. The last ten seconds: Ember.
//
// All five looks are in the markup at once and CSS shows the venue's one (data-style), so a
// style change never swaps Arrow templates (parts.mjs explains why that matters). Display
// baseline (TECH-SPEC 3.3): no flex gap; the ring animates stroke-dasharray.
//
// This module has no imports, so bun tests load it directly; `html` comes from the caller.

/** @typedef {import("../../src/shared/protocol").TimerView} TimerView */
/** @typedef {import("../../src/shared/formats").CountdownStyle} CountdownStyle */

/** The last ten seconds are hot. */
export const HOT_MS = 10_000;
export const STYLES = ["number", "ring", "bar", "dashed", "flip"];
/** Segments in the dashed bar: 20 on the TV, 12 on phones and the host. */
const SEGS = { tv: 20, small: 12 };
const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

/**
 * What a timer shows now. Digits hold at 00 when the time is up; nothing here says "locked".
 * Before the host starts the timer it shows the full time, dimmed (idle).
 * @param {TimerView | null | undefined} timer
 * @param {number} now server time
 */
export function countdownNow(timer, now) {
  if (!timer) return { secs: 0, text: "", fraction: 0, hot: false, idle: true, running: false, paused: false, started: false, done: false };
  const dur = timer.durationMs > 0 ? timer.durationMs : 1;
  let left = dur;
  if (timer.state === "running" && timer.locksAt !== null) left = Math.max(0, timer.locksAt - now);
  else if (timer.state === "paused" && timer.remainingMs !== null) left = Math.max(0, timer.remainingMs);
  else if (timer.state === "done") left = 0;
  const secs = Math.ceil(left / 1000);
  const started = timer.state !== "idle";
  return {
    secs,
    text: countdownText(secs),
    fraction: Math.max(0, Math.min(1, left / dur)),
    hot: started && left <= HOT_MS,
    idle: !started,
    running: timer.state === "running",
    paused: timer.state === "paused",
    started,
    done: timer.state === "done" || (started && left <= 0),
  };
}

/** "08", "41", "60", "1:45" (two digits below 100 s, minutes and seconds above). @param {number} secs */
export function countdownText(secs) {
  const s = Math.max(0, Math.floor(secs));
  if (s >= 100) return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  return String(s).padStart(2, "0");
}

/** A valid style, or ring. @param {unknown} s @returns {CountdownStyle} */
export function countdownStyle(s) {
  return /** @type {CountdownStyle} */ (STYLES.includes(/** @type {string} */ (s)) ? s : "ring");
}

/**
 * The countdown as an Arrow template.
 * @param {(strings: TemplateStringsArray, ...values: any[]) => any} html Arrow's html
 * @param {{
 *   style: () => unknown;
 *   timer: () => TimerView | null | undefined;
 *   now: () => number;
 *   size: "tv" | "small";
 *   label?: () => string;
 * }} o `label`: words beside the small countdown ("seconds left", "Not started", "Paused")
 */
export function countdown(html, o) {
  const st = () => countdownNow(o.timer(), o.now());
  const segs = SEGS[o.size];
  const digit = (/** @type {number} */ i) => () => {
    const d = st().text.replace(":", "");
    return d.charAt(i);
  };
  // Flip (UI-17): each card's lower flap falls into place when its digit changes. The class
  // swaps between two copies of the same animation (by the digit's parity, which changes on every
  // tick of that digit), which restarts it without touching the DOM. Only while running.
  const flipCls = (/** @type {number} */ i, /** @type {string} */ hideWhenShort) => () => {
    const s = st();
    if (i === 2 && s.text.length <= 2) return hideWhenShort;
    if (!s.running) return "";
    const ch = s.text.replace(":", "").charCodeAt(i) || 0;
    return ch % 2 ? "fa" : "fb";
  };
  const segOn = (/** @type {number} */ i) => () => (i < Math.ceil(st().fraction * segs) ? "on" : "");
  return html`<div class="${() => "cd cd-" + o.size + (st().hot ? " hot" : "") + (st().idle ? " idle" : "") + (st().paused ? " paused" : "")}"
      data-style="${() => countdownStyle(o.style())}" role="timer" aria-label="${() => (st().idle ? "Timer not started" : st().secs + " seconds left")}">
    <span class="cd-ringbox" aria-hidden="true"><svg class="cd-ring" viewBox="0 0 100 100"><circle class="cd-ring-track" cx="50" cy="50" r="${RING_R}"></circle><circle class="cd-ring-arc" cx="50" cy="50" r="${RING_R}"
      stroke-dasharray="${() => (RING_C * st().fraction).toFixed(2) + " " + RING_C.toFixed(2)}"></circle></svg></span>
    <span class="cd-num" aria-hidden="true">${() => st().text}</span>
    <span class="cd-track" aria-hidden="true"><span class="cd-fill" style="${() => "transform:scaleX(" + st().fraction + ")"}"></span></span>
    <span class="cd-segs" aria-hidden="true">${Array.from({ length: segs }, (_, i) => html`<i class="${segOn(i)}"></i>`)}</span>
    <span class="cd-flip" aria-hidden="true"><b class="${flipCls(0, "")}" data-d="${digit(0)}"></b><b class="${flipCls(1, "")}" data-d="${digit(1)}"></b><b class="${flipCls(2, "none")}" data-d="${digit(2)}"></b></span>
    ${o.label ? html`<span class="cd-label">${o.label}</span>` : ""}
  </div>`;
}
