// Question image URLs carry the night and the image's identity (code review LI-003).
import { afterEach, describe, expect, test } from "bun:test";
import type { ServerMsg } from "../../src/shared/protocol.ts";
import { imageUrl } from "../../src/server/night/media.ts";
import { connectClient, type TestClient } from "../helpers/client.ts";
import { FakeClock } from "../helpers/fake-clock.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";
import { fakeCopy, fakeRules, makeQuiz, q, text, writeQuiz } from "../night/fakes.ts";

const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 1, 2, 3]);
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xbb, 4, 5, 6]);

const open: TestClient[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  while (open.length) open.pop()!.close();
  while (servers.length) await servers.pop()!.stop();
});

async function client(s: TestServer, role: "host" | "display" | "team", cookie?: string) {
  const c = await connectClient(s, { role, cookie });
  open.push(c);
  await c.hello({});
  return c;
}
function view(c: TestClient): any {
  const states = c.received.filter((m): m is Extract<ServerMsg, { t: "state" }> => m.t === "state");
  return states[states.length - 1]!.view;
}
async function ok(c: TestClient, name: string, args: object = {}) {
  const ack = await c.cmd(name, args);
  if (!ack.ok) throw new Error(`${name}: ${JSON.stringify(ack.error)}`);
  return ack.result as any;
}

/** Opens a night of the quiz, joins a team and shows the image question; returns its public URL. */
async function playImage(s: TestServer, host: TestClient, quizId: string, imageIndex: number) {
  const { roomCode } = await ok(host, "night.open", { quizId });
  const phone = await client(s, "team");
  await ok(phone, "team.join", { roomCode, name: `Team ${Math.random().toString(36).slice(2, 6)}` });
  await ok(host, "quiz.start");
  await ok(host, "round.start");
  for (let i = 0; i <= imageIndex; i++) await ok(host, "question.next");
  await Bun.sleep(100);
  const qv = view(phone).questions?.find((x: any) => x.image) ?? view(phone).question;
  return { url: (qv?.image ?? null) as string, phone };
}

describe("question image identity (LI-003)", () => {
  test("a new night with different bytes under the same question id gets a new URL; the old URL does not serve the new bytes", async () => {
    const s = await startTestServer({ clock: new FakeClock(), services: { rules: fakeRules, copyPicker: fakeCopy() } });
    servers.push(s);
    const img = q(text("Abbey Road"), { media: { kind: "image", file: "cover.png" } });
    const quiz = makeQuiz("img-identity", [[img]]);
    writeQuiz(s.dataDir, quiz, { "cover.png": PNG_A });
    const cookie = await s.signIn();
    const host = await client(s, "host", cookie);

    const first = await playImage(s, host, quiz.id, 0);
    expect(first.url.startsWith(`/media/q/${img.id}?`)).toBe(true);
    const a = await s.fetch(first.url);
    expect(a.status).toBe(200);
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(PNG_A);
    expect(a.headers.get("cache-control")).toContain("max-age");
    await ok(host, "quiz.end", { early: true });
    await ok(host, "night.close");

    // The image is replaced between nights (same question id, same file name).
    writeQuiz(s.dataDir, quiz, { "cover.png": PNG_B });
    const second = await playImage(s, host, quiz.id, 0);
    expect(second.url).not.toBe(first.url);
    const b = await s.fetch(second.url);
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(PNG_B);
    // The previous night's address no longer answers with this night's picture.
    expect((await s.fetch(first.url)).status).toBe(404);
  });

  test("a version parameter does not get round the shown-question gate", async () => {
    const s = await startTestServer({ clock: new FakeClock(), services: { rules: fakeRules, copyPicker: fakeCopy() } });
    servers.push(s);
    const img = q(text("Abbey Road"), { media: { kind: "image", file: "cover.png" } });
    const quiz = makeQuiz("img-hidden", [[q(text("first")), img]]);
    writeQuiz(s.dataDir, quiz, { "cover.png": PNG_A });
    const cookie = await s.signIn();
    const host = await client(s, "host", cookie);
    await playImage(s, host, quiz.id, 0);     // only the first question is shown
    const hostImage = imageUrl(view(host).night.id, img.id, "cover.png");
    expect((await s.fetch(hostImage)).status).toBe(404);
    expect((await s.fetch(hostImage, { cookie })).status).toBe(200);
    expect((await s.fetch(`/media/q/${img.id}`)).status).toBe(404);
  });

  test("a sudden-death question can have a picture: shown to the tied phones once asked (the display gets the same question view) (UI-62)", async () => {
    const s = await startTestServer({ clock: new FakeClock(), services: { rules: fakeRules, copyPicker: fakeCopy() } });
    servers.push(s);
    const sdq = q(text("Abbey Road"), { media: { kind: "image", file: "cover.png" } });
    const quiz = makeQuiz("img-sd", [[q(text("x"))]], {}, [sdq]);
    writeQuiz(s.dataDir, quiz, { "cover.png": PNG_A });
    const cookie = await s.signIn();
    const host = await client(s, "host", cookie);
    const { roomCode } = await ok(host, "night.open", { quizId: quiz.id });
    const phones = [await client(s, "team"), await client(s, "team")];
    for (const [i, p] of phones.entries()) await ok(p, "team.join", { roomCode, name: `Team ${i}` });
    await ok(host, "quiz.start");
    await ok(host, "round.start");
    await ok(host, "question.next");
    await ok(host, "lock");
    await ok(host, "round.finish");
    await ok(host, "leaderboard.show");
    await ok(host, "sd.start");
    await Bun.sleep(50);
    expect(view(phones[0]!).suddenDeath.question).toBeNull();
    expect((await s.fetch(`/media/q/${sdq.id}`)).status).toBe(404);   // not asked yet
    await ok(host, "sd.ask");
    await Bun.sleep(100);
    const url = view(phones[0]!).suddenDeath.question.image as string;
    expect(url.startsWith(`/media/q/${sdq.id}?`)).toBe(true);
    expect(view(phones[1]!).suddenDeath.question.image).toBe(url);
    const res = await s.fetch(url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_A);
  });
});
