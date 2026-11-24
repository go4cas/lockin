// Quiz image file names (code review LI-004, security audit SA-20).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuizStore } from "../../src/server/quizzes/store.ts";

const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n & 0xff, (n >> 8) & 0xff, 7, 7]);
const prefix = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 4);

/** Two different PNGs whose SHA-256 starts with the same 4 hex characters. */
function collidingPair(): [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>] {
  const seen = new Map<string, number>();
  for (let n = 0; n < 65536; n++) {
    const p = prefix(png(n));
    const other = seen.get(p);
    if (other !== undefined) return [png(other), png(n)];
    seen.set(p, n);
  }
  throw new Error("no pair");
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "lockin-media-"));
  let now = Date.UTC(2026, 10, 24, 12);
  let inUse = false;
  const store = new QuizStore({ dir, inUse: () => inUse, now: () => now } as ConstructorParameters<typeof QuizStore>[0]);
  const quiz = store.create("Pictures");
  const media = join(dir, quiz.id, "media");
  return { dir, store, quiz, media, advance: (ms: number) => { now += ms; }, setInUse: (v: boolean) => { inUse = v; } };
}

describe("saveMedia identities (LI-004, SA-20)", () => {
  test("two different pictures sharing a 4-hex prefix get two files with their own bytes", () => {
    const { store, quiz, media } = setup();
    const [a, b] = collidingPair();
    expect(prefix(a)).toBe(prefix(b));
    const fa = store.saveMedia(quiz.id, "q-abcdefgh", a);
    const fb = store.saveMedia(quiz.id, "q-abcdefgh", b);
    expect(fa).not.toBe(fb);
    expect(new Uint8Array(readFileSync(join(media, fa)))).toEqual(a);
    expect(new Uint8Array(readFileSync(join(media, fb)))).toEqual(b);
  });

  test("the same picture twice reuses its file", () => {
    const { store, quiz, media } = setup();
    const f1 = store.saveMedia(quiz.id, "q-abcdefgh", png(1));
    const f2 = store.saveMedia(quiz.id, "q-abcdefgh", png(1));
    expect(f2).toBe(f1);
    expect(f1).toMatch(/^q-abcdefgh-[0-9a-f]{16}\.png$/);
    expect(readdirSync(media)).toEqual([f1]);
  });

  test("a file already at the name with other bytes is never treated as the same picture", () => {
    const { store, quiz, media } = setup();
    const f = store.saveMedia(quiz.id, "q-abcdefgh", png(1));
    Bun.write(join(media, f), png(2));   // hand-edited folder: the name no longer matches its bytes
    const again = store.saveMedia(quiz.id, "q-abcdefgh", png(1));
    expect(again).not.toBe(f);
    expect(new Uint8Array(readFileSync(join(media, again)))).toEqual(png(1));
  });
});

describe("unreferenced media clean-up (SA-20)", () => {
  function withImage(quiz: any, file: string | null) {
    const q = structuredClone(quiz);
    q.rounds[0].questions = [{ id: "q-abcdefgh", text: "Whose cover?", ...(file ? { media: { kind: "image", file } } : {}), answer: { type: "text", accepted: ["Abbey Road"] } }];
    return q;
  }

  test("saving a draft removes an old unreferenced picture and keeps referenced and recent ones", () => {
    const { store, quiz, media, advance } = setup();
    const old = store.saveMedia(quiz.id, "q-abcdefgh", png(1));
    const used = store.saveMedia(quiz.id, "q-abcdefgh", png(2));
    const past = new Date(Date.now() - 2 * 3600_000);
    utimesSync(join(media, old), past, past);
    utimesSync(join(media, used), past, past);
    const fresh = store.saveMedia(quiz.id, "q-abcdefgh", png(3));   // uploaded, not saved into the draft yet
    advance(1000);
    const saved = store.save(quiz.id, withImage(quiz, used), quiz.updatedAt);
    expect(saved.quiz.rounds[0]!.questions[0]!.media).toEqual({ kind: "image", file: used });
    expect(existsSync(join(media, used))).toBe(true);
    expect(existsSync(join(media, fresh))).toBe(true);
    expect(existsSync(join(media, old))).toBe(false);
  });

  test("files that are not quiz images are left alone", () => {
    const { store, quiz, media, advance } = setup();
    Bun.write(join(media, "notes.txt"), "keep me");
    const past = new Date(Date.now() - 2 * 3600_000);
    advance(1000);
    store.save(quiz.id, withImage(quiz, null), quiz.updatedAt);
    utimesSync(join(media, "notes.txt"), past, past);
    const q2 = store.get(quiz.id).quiz;
    store.save(quiz.id, withImage(q2, null), q2.updatedAt);
    expect(existsSync(join(media, "notes.txt"))).toBe(true);
  });
});
