// REVIEW finding 4: display pairing. /display needs no sign-in (T-01), but an unpaired display
// sees only a pairing code, and a phone that is not in a team gets no room code or questions.
import { afterEach, describe, expect, test } from "bun:test";
import type { DisplayView, HostView, ServerMsg, TeamView } from "../../src/shared/protocol.ts";
import { DisplayPairing } from "../../src/server/display/pairing.ts";
import { engines } from "../../src/server/night/index.ts";
import { connectClient, type TestClient } from "../helpers/client.ts";
import { FakeClock } from "../helpers/fake-clock.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";
import { fakeCopy, fakeRules, makeQuiz, q, text, writeQuiz } from "../night/fakes.ts";

const open: TestClient[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  while (open.length) open.pop()!.close();
  while (servers.length) await servers.pop()!.stop();
});

async function setup() {
  const clock = new FakeClock();
  const s = await startTestServer({ clock });
  servers.push(s);
  s.app.services.rules = fakeRules;
  s.app.services.copyPicker = fakeCopy();
  writeQuiz(s.dataDir, makeQuiz("pairing", [[q(text("Fleetwood Mac"), { text: "Who made Rumours?" }), q(text("Abbey Road"))]], { timerSeconds: 30 }));
  const cookie = await s.signIn();
  const host = await client(s, "host", cookie);
  const { roomCode } = await ok(host, "night.open", { quizId: "pairing" }) as { roomCode: string };
  const { scheduler } = engines.get(s.app)!;
  return { s, clock, cookie, host, roomCode, scheduler };
}

async function client(s: TestServer, role: "host" | "display" | "team", cookie?: string, token?: string) {
  const c = await connectClient(s, { role, cookie });
  open.push(c);
  await c.hello(token ? { token } : {});
  return c;
}

function view<T>(c: TestClient): T {
  const states = c.received.filter((m): m is Extract<ServerMsg, { t: "state" }> => m.t === "state");
  return states[states.length - 1]!.view as T;
}
async function ok(c: TestClient, name: string, args: object = {}) {
  const ack = await c.cmd(name, args);
  if (!ack.ok) throw new Error(`${name}: ${JSON.stringify(ack.error)}`);
  return ack.result as Record<string, unknown>;
}
const errCode = async (c: TestClient, name: string, args: object = {}) => {
  const ack = await c.cmd(name, args);
  return ack.ok ? "ok" : ack.error.code;
};
const settle = () => Bun.sleep(300);   // host-only updates are sent at most every 250 ms (SA-04)
/** Everything a client has received, as one string, to search for leaks. */
const everything = (c: TestClient) => JSON.stringify(c.received);

describe("display pairing (REVIEW finding 4)", () => {
  test("an unpaired display sees only a 6-digit code: no room code, no teams, no night", async () => {
    const { s, roomCode } = await setup();
    const tv = await client(s, "display");
    const v = view<DisplayView>(tv);
    expect(v.pairing!.code).toMatch(/^[0-9]{6}$/);
    expect(v.phase).toBe("idle");
    expect(v.night).toBeNull();
    expect(everything(tv)).not.toContain(roomCode);
    // and it cannot pair itself or run any command
    expect(await errCode(tv, "display.pair", { code: v.pairing!.code })).toBe("not_allowed");
  });

  test("the host types the code: the display gets a token and the night; the token pairs it again later", async () => {
    const { s, host, roomCode } = await setup();
    const tv = await client(s, "display");
    const code = view<DisplayView>(tv).pairing!.code;
    await settle();
    expect(view<HostView>(host).displays).toEqual({ paired: 0, connected: 0, waiting: 1, list: [], bySession: 0 });

    const wrong = code === "000000" ? "000001" : "000000";
    expect(await errCode(host, "display.pair", { code: wrong })).toBe("bad_code");
    const result = await ok(host, "display.pair", { code });
    // SA-03: the host is told where the paired screen is and how long it has been waiting
    expect(result).toEqual({ paired: 1, ip: "127.0.0.1", connectedFor: expect.any(Number), id: expect.stringMatching(/^[0-9a-f]{8}$/) });
    await settle();
    const paired = tv.received.find((m): m is Extract<ServerMsg, { t: "paired" }> => m.t === "paired");
    expect(paired!.token.length).toBeGreaterThan(20);
    const v = view<DisplayView>(tv);
    expect(v.pairing ?? null).toBeNull();
    expect(v.night!.roomCode).toBe(roomCode);
    expect(view<HostView>(host).displays).toEqual({
      paired: 1, connected: 1, waiting: 0, bySession: 0,
      list: [{ id: result.id as string, pairedAt: s.app.clock.now(), lastSeenAt: s.app.clock.now(), connected: true, ip: "127.0.0.1" }],
    });
    // the code is used up
    expect(await errCode(host, "display.pair", { code })).toBe("bad_code");

    // a reload sends the token in hello and is paired at once
    const again = await client(s, "display", undefined, paired!.token);
    expect(view<DisplayView>(again).night!.roomCode).toBe(roomCode);
    // the join QR is served to it with its token in a header (SA-11), and to nobody without one
    expect((await s.fetch("/qr/join.svg", { headers: { Authorization: `Bearer ${paired!.token}` } })).status).toBe(200);
    expect((await s.fetch("/qr/join.svg")).status).toBe(404);
    // the token survives a restart (stored hashed in displays.json)
    const raw = await Bun.file(`${s.dataDir}/displays.json`).text();
    expect(raw).not.toContain(paired!.token);
    expect(new DisplayPairing(s.dataDir, s.app.clock).isPaired(paired!.token)).toBe(true);
  });

  test("D5: a display opened from a browser signed in to the console is paired by the session, with no stored token", async () => {
    const { s, host, cookie, roomCode } = await setup();
    const tv = await client(s, "display", cookie);
    expect(tv.received.some((m) => m.t === "paired")).toBe(false);   // no token to keep
    expect(view<DisplayView>(tv).night!.roomCode).toBe(roomCode);
    expect(s.app.services.displayPairing!.pairedCount).toBe(0);     // nothing stored
    await settle();
    expect(view<HostView>(host).displays).toMatchObject({ paired: 0, connected: 1, bySession: 1, list: [] });
    // its QR comes by the session cookie
    expect((await s.fetch("/qr/join.svg", { cookie })).status).toBe(200);
  });

  test("D5: signing out unpairs the session's display at once", async () => {
    const { s, cookie, roomCode } = await setup();
    const tv = await client(s, "display", cookie);
    const res = await s.fetch("/api/auth/logout", { method: "POST", cookie });
    expect(res.status).toBe(200);
    await settle();
    const v = view<DisplayView>(tv);
    expect(v.pairing!.code).toMatch(/^[0-9]{6}$/);
    expect(v.night).toBeNull();
    // and a reload with the old cookie is not paired
    const again = await client(s, "display", cookie);
    expect(view<DisplayView>(again).pairing).toBeTruthy();
    expect(everything(again)).not.toContain(roomCode);
  });

  test("SA-11: unpair one display; the other stays paired", async () => {
    const { s, host, roomCode } = await setup();
    const a = await client(s, "display");
    const b = await client(s, "display");
    const ra = await ok(host, "display.pair", { code: view<DisplayView>(a).pairing!.code }) as { id: string };
    const rb = await ok(host, "display.pair", { code: view<DisplayView>(b).pairing!.code }) as { id: string };
    await settle();
    expect(view<HostView>(host).displays!.list!.map((d) => d.id)).toEqual([ra.id, rb.id]);
    const tokenA = a.received.find((m): m is Extract<ServerMsg, { t: "paired" }> => m.t === "paired")!.token;

    expect(await ok(host, "display.unpair", { id: ra.id })).toEqual({ paired: 1 });
    await settle();
    expect(view<DisplayView>(a).pairing!.code).toMatch(/^[0-9]{6}$/);
    expect(view<DisplayView>(a).night).toBeNull();
    expect(view<DisplayView>(b).night!.roomCode).toBe(roomCode);
    expect(view<HostView>(host).displays!.list!.map((d) => d.id)).toEqual([rb.id]);
    // its token is dead, also after a restart
    expect(s.app.services.displayPairing!.isPaired(tokenA)).toBe(false);
    expect(new DisplayPairing(s.dataDir, s.app.clock).isPaired(tokenA)).toBe(false);
    expect(await errCode(host, "display.unpair", { id: ra.id })).toBe("not_found");
    expect(await errCode(host, "display.unpair", { id: "nope" })).toBe("bad_args");
  });

  test("SA-11: a pairing unused for 90 days is refused at hello and dropped; one in use is kept", async () => {
    const { s, host, clock, roomCode } = await setup();
    const old = await client(s, "display");
    const used = await client(s, "display");
    await ok(host, "display.pair", { code: view<DisplayView>(old).pairing!.code });
    await ok(host, "display.pair", { code: view<DisplayView>(used).pairing!.code });
    const tokenOf = (c: TestClient) => c.received.find((m): m is Extract<ServerMsg, { t: "paired" }> => m.t === "paired")!.token;
    const [oldToken, usedToken] = [tokenOf(old), tokenOf(used)];
    old.close(); used.close();
    await Bun.sleep(50);
    clock.advance(60 * 24 * 60 * 60_000);   // 60 days: the second TV comes back
    const back = await client(s, "display", undefined, usedToken);
    expect(view<DisplayView>(back).night!.roomCode).toBe(roomCode);
    back.close();
    await Bun.sleep(50);
    clock.advance(31 * 24 * 60 * 60_000);   // 91 days after pairing, 31 after the second was last seen
    const stale = await client(s, "display", undefined, oldToken);
    expect(view<DisplayView>(stale).pairing!.code).toMatch(/^[0-9]{6}$/);
    expect(everything(stale)).not.toContain(roomCode);
    const fresh = await client(s, "display", undefined, usedToken);
    expect(view<DisplayView>(fresh).night!.roomCode).toBe(roomCode);
    expect(s.app.services.displayPairing!.pairedCount).toBe(1);
    expect(new DisplayPairing(s.dataDir, clock).isPaired(oldToken)).toBe(false);
  });

  test("unpair every display: paired screens go back to a code and old tokens stop working", async () => {
    const { s, host, roomCode } = await setup();
    const tv = await client(s, "display");
    await ok(host, "display.pair", { code: view<DisplayView>(tv).pairing!.code });
    const token = tv.received.find((m): m is Extract<ServerMsg, { t: "paired" }> => m.t === "paired")!.token;
    expect(await ok(host, "display.unpairAll")).toEqual({ unpaired: 1 });
    await settle();
    expect(view<DisplayView>(tv).pairing!.code).toMatch(/^[0-9]{6}$/);
    expect(view<DisplayView>(tv).night).toBeNull();
    const old = await client(s, "display", undefined, token);
    expect(view<DisplayView>(old).pairing).toBeTruthy();
    expect(everything(old)).not.toContain(roomCode);
    expect((await s.fetch("/qr/join.svg", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
  });

  test("wrong codes from the console are limited to 10 a minute", async () => {
    const { s, host, clock } = await setup();
    const tv = await client(s, "display");
    const code = view<DisplayView>(tv).pairing!.code;
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 10; i++) expect(await errCode(host, "display.pair", { code: wrong })).toBe("bad_code");
    expect(await errCode(host, "display.pair", { code })).toBe("too_many_tries");
    clock.advance(60_001);
    expect(await errCode(host, "display.pair", { code })).toBe("ok");
  });

  test("teams and displays cannot pair or unpair", async () => {
    const { s } = await setup();
    const phone = await client(s, "team");
    expect(await errCode(phone, "display.pair", { code: "1234" })).toBe("not_allowed");
    expect(await errCode(phone, "display.unpairAll")).toBe("not_allowed");
    expect(await errCode(phone, "display.unpair", { id: "0123abcd" })).toBe("not_allowed");
  });
});

describe("a phone that is not in a team (REVIEW finding 4)", () => {
  test("gets no room code and no questions; a joined phone gets both", async () => {
    const { s, host, roomCode } = await setup();
    const stranger = await client(s, "team");
    const member = await client(s, "team");
    await ok(member, "team.join", { roomCode, name: "Les Quizerables" });
    await ok(host, "quiz.start");
    await ok(host, "round.start");
    await ok(host, "question.next");
    await settle();
    const sv = view<TeamView>(stranger);
    expect(sv.phase).toBe("asking");
    expect(sv.night!.roomCode).toBe("");
    expect(sv.night!.joinUrl).toBe("");
    expect(sv.questions).toEqual([]);
    expect(everything(stranger)).not.toContain(roomCode);
    expect(everything(stranger)).not.toContain("Rumours");   // not even the question text
    const mv = view<TeamView>(member);
    expect(mv.night!.roomCode).toBe(roomCode);
    expect(mv.questions.map((x) => x.text)).toEqual(["Who made Rumours?"]);
  });
});
