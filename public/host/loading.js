// @ts-check
// The console's loading indicator (UI-35): the Lock-In mark's ring with its venue arc turning,
// in place of "Loading…" text. The words stay for screen readers (role="status").
// `loading(label)` is a page or panel loader (32 px, with room around it);
// `spinner()` is the 16 px one for inside a button or a status pill, next to its word.
// With reduced motion the arc pulses instead of turning. CSS: .loading and .spin in host.css.
import { html } from "/vendor/arrow/index.mjs";

const ring = (/** @type {string} */ cls) => html`<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">
  <circle class="spin-track" cx="50" cy="50" r="38"></circle><circle class="spin-arc" cx="50" cy="50" r="38" stroke-dasharray="54 239"></circle></svg>`;

/** A loader for a page or a panel; `label` is read out, not shown. @param {string} label */
export const loading = (label) => html`<div class="loading" role="status">${ring("spin")}<span class="visually-hidden">${label}</span></div>`;

/** A small loader for inside a button or a pill, next to its word. */
export const spinner = () => ring("spin s");
