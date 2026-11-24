// The shared rendering primitives (code review LI-017): row pools, slot keys, retained
// boxes and the display's bounded error recovery. The Arrow behaviour they work around is
// covered by the browser checks (tools/browser); these pin the primitives' own contracts.
import { describe, expect, test } from "bun:test";
import { pool, recovery, retained, slotKeys } from "../../public/shared/parts.mjs";

const keyed = (label: string) => ({ label, key(k: string) { return { label, k }; } });

describe("pool", () => {
  test("only grows, and row i reads item i now", () => {
    let items = ["a", "b", "c"];
    const gets: (() => string | undefined)[] = [];
    const rows = pool(() => items, (get, i) => { gets[i] = get; return keyed(String(i)); });
    expect(rows().map((r) => r.k)).toEqual(["0", "1", "2"]);
    items = ["x"];
    expect(rows()).toHaveLength(3);                  // spare rows stay mounted
    expect(gets[0]!()).toBe("x");
    expect(gets[2]!()).toBeUndefined();              // so the row hides itself
    items = ["1", "2", "3", "4"];
    expect(rows().map((r) => r.k)).toEqual(["0", "1", "2", "3"]);
  });
});

describe("slotKeys", () => {
  test("a key is never used twice in the same slot, even coming back to it", () => {
    const one = slotKeys();
    const seen = new Set<string>();
    for (const k of ["q1", "q1", "q2", "q1", "q2"]) seen.add(one("question", keyed(k), k)[0].k);
    expect([...seen]).toEqual(["q1#1", "q2#2", "q1#3", "q2#4"]);
  });
  test("slots count separately; separate sets don't share counts", () => {
    const one = slotKeys();
    expect(one("a", keyed("x"), "x")[0].k).toBe("x#1");
    expect(one("b", keyed("x"), "x")[0].k).toBe("x#1");
    expect(slotKeys()("a", keyed("x"), "x")[0].k).toBe("x#1");
  });
});

/** Just enough DOM for retained(). */
function fakeHolder() {
  const children: any[] = [];
  const doc = { createElement: () => ({ className: "", dataset: {} as Record<string, string>, hidden: false }) };
  return { holder: { ownerDocument: doc, appendChild: (c: any) => children.push(c) } as any, children };
}

describe("retained", () => {
  test("builds each box once, hidden while building, and only hides and shows after", () => {
    const { holder, children } = fakeHolder();
    const boxes = retained(holder, "part", "part");
    const builds: string[] = [];
    const build = (name: string) => (box: any) => { builds.push(name); expect(box.hidden).toBe(true); };
    const a = boxes.ensure("a", build("a"));
    boxes.show("a");
    const b = boxes.ensure("b", build("b"));
    boxes.show("b");
    expect(boxes.ensure("a", build("a"))).toBe(a);
    boxes.show("a");
    expect(builds).toEqual(["a", "b"]);
    expect(children).toEqual([a, b]);
    expect([a.hidden, b.hidden]).toEqual([false, true]);
    expect(a.className).toBe("part");
    expect(a.dataset.part).toBe("a");
  });
  test("an unknown name or none hides the one on show", () => {
    const { holder } = fakeHolder();
    const boxes = retained(holder, "screen");
    const a = boxes.ensure("a", () => {});
    boxes.show("a");
    boxes.show("nope");
    expect(a.hidden).toBe(true);
    expect(boxes.showing()).toBe("nope");
    expect(a.dataset).toEqual({});
  });
});

describe("recovery", () => {
  const origin = "https://quiz.example";
  test("only errors from the listed scripts on this origin count as rendering errors", () => {
    const r = recovery({ sources: ["/vendor/arrow/", "/static/display/"] });
    expect(r.isRenderError({ filename: `${origin}/vendor/arrow/chunks/internal-x.mjs` }, origin)).toBe(true);
    expect(r.isRenderError({ filename: `${origin}/static/display/display.mjs?v=2` }, origin)).toBe(true);
    expect(r.isRenderError({ filename: `${origin}/static/shared/ws-client.js` }, origin)).toBe(false);
    expect(r.isRenderError({ filename: "" }, origin)).toBe(false);                       // "Script error."
    expect(r.isRenderError({ filename: "chrome-extension://abc/vendor/arrow/x.js" }, origin)).toBe(false);
    expect(r.isRenderError({ filename: `https://quiz.example.evil/vendor/arrow/x.mjs` }, origin)).toBe(false);
    expect(r.isRenderError({}, origin)).toBe(false);
  });
  test("one error recovers; an error that keeps coming back stops at the limit", () => {
    let t = 0;
    const r = recovery({ limit: 3, windowMs: 60_000, now: () => t });
    expect(r.allow()).toBe(true);
    let allowed = 0;
    for (let i = 0; i < 900; i++) { t += 60; if (r.allow()) allowed++; }   // a loop: an error every remount
    expect(allowed).toBe(2);
    expect(r.stats()).toEqual({ recent: 3, skipped: 898 });
  });
  test("recovers again once the oldest remount is a window old (the screen never stays stuck)", () => {
    let t = 0;
    const r = recovery({ limit: 2, windowMs: 1000, now: () => t });
    expect([r.allow(), r.allow(), r.allow()]).toEqual([true, true, false]);
    t = 999;
    expect(r.allow()).toBe(false);
    t = 1000;
    expect(r.allow()).toBe(true);
  });
});
