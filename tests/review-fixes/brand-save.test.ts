// Branding saves keep edits made while the save is on its way (code review LI-007).
import { describe, expect, test } from "bun:test";
import { saveDraft } from "../../public/host/brand/save.js";

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A tiny stand-in for the branding page: a draft, a saved baseline and the dirty check. */
function page(initial: Record<string, unknown>) {
  const p = {
    draft: { ...initial } as Record<string, unknown>,
    saved: JSON.stringify(initial),
    dirty: () => JSON.stringify(p.draft) !== p.saved,
  };
  return p;
}

describe("saveDraft (LI-007)", () => {
  test("an edit made while saving stays, and the page offers another save", async () => {
    const p = page({ name: "The Hanks", accent: "#ff0000", prizes: ["Beer"] });
    p.draft.name = "The Hanks Arms";
    const put = deferred<Record<string, unknown>>();
    const saving = saveDraft({
      snapshot: () => JSON.stringify(p.draft),
      send: () => put.promise,
      setSaved: (res: unknown) => { p.saved = JSON.stringify(res); },
      apply: (res: Record<string, unknown>) => { p.draft = { ...res }; },
    });
    p.draft.name = "The Hanks Arms & Kitchen";   // typed after pressing Save
    p.draft.accent = "#00ff00";                  // an upload or colour pick landing meanwhile
    put.resolve({ name: "The Hanks Arms", accent: "#ff0000", prizes: ["Beer"] });
    const r = await saving;
    expect(r.keptEdits).toBe(true);
    expect(p.draft.name).toBe("The Hanks Arms & Kitchen");
    expect(p.draft.accent).toBe("#00ff00");
    expect(p.dirty()).toBe(true);
    expect(JSON.parse(p.saved).name).toBe("The Hanks Arms");
  });

  test("with no edits meanwhile the draft takes the server's copy and is clean", async () => {
    const p = page({ name: "x", prizes: [] });
    p.draft.name = "  Lock-In Arms ";
    const r = await saveDraft({
      snapshot: () => JSON.stringify(p.draft),
      send: async (body: Record<string, unknown>) => ({ ...body, name: String(body.name).trim() }),   // the server normalises
      setSaved: (res: unknown) => { p.saved = JSON.stringify(res); },
      apply: (res: Record<string, unknown>) => { p.draft = { ...res }; },
    });
    expect(r.keptEdits).toBe(false);
    expect(p.draft.name).toBe("Lock-In Arms");
    expect(p.dirty()).toBe(false);
  });

  test("an error keeps the old baseline and the edits", async () => {
    const p = page({ name: "x" });
    p.draft.name = "y";
    await expect(saveDraft({
      snapshot: () => JSON.stringify(p.draft),
      send: async () => { throw new Error("The venue name is too long."); },
      setSaved: (res: unknown) => { p.saved = JSON.stringify(res); },
      apply: (res: Record<string, unknown>) => { p.draft = { ...res }; },
    })).rejects.toThrow("too long");
    expect(p.draft.name).toBe("y");
    expect(JSON.parse(p.saved).name).toBe("x");
    expect(p.dirty()).toBe(true);
  });
});
