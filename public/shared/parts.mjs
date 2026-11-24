// @ts-check
// Shared rendering primitives for the host console, the phone and the display (code review
// LI-017). They hold what Lock-In learned about the vendored Arrow 1.0.6 in one place, so a
// fix or an Arrow upgrade changes one file instead of three copies (NOTES, B5 to B7):
//
//   Arrow 1.0.6 throws ("expressionPool[effect] is not a function", "setEndAfter … has no
//   parent") when it removes a template whose own slots still have updates queued, and the
//   throw drops the rest of that update. Its removed templates' watchers can also keep running.
//
// So the pages never remove a template that has live slots inside:
//   - pool():     lists are row pools that only grow; a spare row hides itself.
//   - slotKeys(): a slot that shows different things gets a key that is never reused.
//   - retained(): screens, parts and dialogs are built once, then only hidden and shown.
// And when a render throws anyway, the display remounts from its last view, at most a few
// times a minute (recovery()).
//
// This module has no imports, so bun tests load it directly; templates come from the caller.

/**
 * A list as a pool of rows that only grows: row i always shows item i, rows past the end
 * stay mounted, and each row template must hide itself when get() is undefined. Rows read
 * their item through get(), so a reused row always shows the current item.
 * @template T
 * @param {() => T[]} items
 * @param {(get: () => T | undefined, i: number) => { key(k: string): any }} render
 * @returns {() => any[]}
 */
export function pool(items, render) {
  let size = 0;
  return () => {
    const n = items().length;
    if (n > size) size = n;
    return Array.from({ length: size }, (_, i) => render(() => items()[i], i).key(String(i)));
  };
}

/**
 * Keys for slots that show one keyed template at a time (a screen, a question), as a
 * one-item list. Two Arrow 1.0.6 behaviours make this necessary: a template with the same
 * markup is patched into the old elements even when its key differs, and a slot remembers a
 * key after its elements are gone, so coming back to that key reuses detached nodes and
 * throws. A keyed list always mounts a new key fresh, and a generation number makes sure a
 * key is never used twice in the same slot.
 * @returns {(slot: string, tpl: { key(k: string): any }, key: string) => any[]}
 */
export function slotKeys() {
  /** @type {Record<string, { key: string; n: number }>} */
  const generations = {};
  return (slot, tpl, key) => {
    const g = generations[slot] ?? (generations[slot] = { key: "", n: 0 });
    if (g.key !== key) { g.key = key; g.n++; }
    return [tpl.key(`${key}#${g.n}`)];
  };
}

/**
 * Boxes in `holder` that are built once and then only hidden and shown. Each box is made
 * the first time ensure() asks for it, hidden, and filled by `build`; show() hides the one on
 * show and shows the named one (an unknown name shows none).
 * @param {HTMLElement} holder
 * @param {string} className
 * @param {string} [dataName] also sets `data-<dataName>` on each box to its name
 */
export function retained(holder, className, dataName) {
  /** @type {Record<string, HTMLElement>} */
  const boxes = {};
  let showing = "";
  return {
    /** The name on show, or "". */
    showing: () => showing,
    /**
     * The box for `name`, built (hidden) the first time.
     * @param {string} name @param {(box: HTMLElement) => void} build
     */
    ensure(name, build) {
      let box = boxes[name];
      if (!box) {
        box = boxes[name] = holder.ownerDocument.createElement("div");
        box.className = className;
        if (dataName) box.dataset[dataName] = name;
        box.hidden = true;
        holder.appendChild(box);
        build(box);
      }
      return box;
    },
    /** @param {string} name */
    show(name) {
      if (name === showing) return;
      const old = showing ? boxes[showing] : undefined;
      if (old) old.hidden = true;
      showing = name;
      const box = name ? boxes[name] : undefined;
      if (box) box.hidden = false;
    },
  };
}

/**
 * When to remount after an error (the display, T-11): only for errors from the page's own
 * rendering code, and at most `limit` times in any `windowMs`, so an error that comes back
 * at once (or one from somewhere else) can't put the screen in an endless remount loop.
 * After the limit, recovery starts again once the oldest remount is older than `windowMs`.
 * @param {{ limit?: number; windowMs?: number; now?: () => number; sources?: string[] }} [opts]
 *   `sources`: path prefixes of the scripts whose errors are rendering errors
 */
export function recovery(opts = {}) {
  const limit = opts.limit ?? 3;
  const windowMs = opts.windowMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const sources = opts.sources ?? ["/vendor/arrow/"];
  /** @type {number[]} */
  let times = [];
  let skipped = 0;
  return {
    /**
     * Whether an error came from rendering: a script of ours on this origin. A cross-origin
     * "Script error." (an extension, an injected script) has no file name and is not ours.
     * @param {{ filename?: string }} e @param {string} origin
     */
    isRenderError(e, origin) {
      const file = e && typeof e.filename === "string" ? e.filename : "";
      if (!file.startsWith(origin + "/")) return false;
      const path = file.slice(origin.length).split("?")[0] ?? "";
      return sources.some((p) => path.startsWith(p));
    },
    /** True if a remount may happen now (and counts it). */
    allow() {
      const t = now();
      times = times.filter((x) => t - x < windowMs);
      if (times.length >= limit) { skipped++; return false; }
      times.push(t);
      return true;
    },
    /** What happened, for diagnostics. */
    stats: () => ({ recent: times.length, skipped }),
  };
}
