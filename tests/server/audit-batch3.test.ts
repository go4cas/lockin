// Security audit Batch 3 (docs/SECURITY-AUDIT.md): SA-13 to SA-21. Each test was run against
// main first and failed there (output in docs/NOTES.md, "Audit Batch 3 fixes").
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGE_CSP } from "../../src/server/http.ts";
import { fillLine } from "../../src/server/branding/copy.ts";
import { personalise as personalisePhone } from "../../src/server/phone/index.ts";
import { personalise as personaliseDisplay } from "../../src/server/display/index.ts";
import { SecurityLog } from "../../src/server/seclog.ts";
import { historyList } from "../../src/server/night/store.ts";
import { connectClient, type TestClient } from "../helpers/client.ts";
import { FakeClock } from "../helpers/fake-clock.ts";
import { startTestServer, TEST_PASSWORD, TEST_PUBLIC_URL, type TestServer } from "../helpers/server.ts";
import { code, fakeCopy, fakeRules, host, joinTeam, makeQuiz, q, rig, text, writeQuiz, type Rig } from "../night/fakes.ts";
import type { Actor } from "../../src/server/night/engine.ts";

const servers: TestServer[] = [];
const clients: TestClient[] = [];
const rigs: Rig[] = [];
afterEach(async () => {
  while (clients.length) clients.pop()!.close();
  while (servers.length) await servers.pop()!.stop();
  while (rigs.length) rigs.pop()!.close();
});

async function server(opts: Parameters<typeof startTestServer>[0] = {}) {
  const s = await startTestServer(opts);
  servers.push(s);
  return s;
}

const HTTPS_URL = "https://quiz.example.com";

// --- SA-13 ---------------------------------------------------------------------------------

describe("SA-13: response headers", () => {
  test("the page CSP closes base-uri, form-action, object-src and names script-src", () => {
    for (const d of ["base-uri 'none'", "form-action 'self'", "object-src 'none'", "script-src 'self'", "frame-ancestors 'none'", "style-src 'self' 'unsafe-inline'"]) {
      expect(PAGE_CSP).toContain(d);
    }
  });

  test("a page, an API answer and an upload carry COOP, CORP and Permissions-Policy; API answers are no-store", async () => {
    const s = await server();
    const cookie = await s.signIn();
    writeQuiz(s.dataDir, makeQuiz("headers", [[q(text("x"))]]));
    const page = await s.fetch("/host", { cookie });
    const api = await s.fetch("/api/quizzes", { cookie });
    const history = await s.fetch("/api/history", { cookie });
    const missing = await s.fetch("/api/nothing");
    for (const res of [page, api, history, missing]) {
      expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(res.headers.get("strict-transport-security")).toBeNull();   // http://localhost: no HSTS
    }
    expect(page.headers.get("content-security-policy")).toBe(PAGE_CSP);
    for (const res of [api, history, missing]) expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("an uploaded picture keeps its sandbox CSP and gets the new headers", async () => {
    const s = await server();
    const cookie = await s.signIn();
    const png = readFileSync(join(import.meta.dir, "../../public/phone/icons/apple-touch-icon.png"));
    const form = new FormData();
    form.set("kind", "logo");
    form.set("file", new Blob([png], { type: "image/png" }), "logo.png");
    const up = await s.fetch("/api/theme/assets", { method: "POST", body: form, cookie });
    expect(up.status).toBe(200);
    const { file } = await up.json() as { file: string };
    const res = await s.fetch(`/theme/assets/${file.replace(/^assets\//, "")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("an https public URL sends HSTS, and the host cookie is __Host- prefixed", async () => {
    const s = await server({ config: { publicUrl: HTTPS_URL } });
    const setupCode = s.app.auth.ensureSetupCode();
    const res = await s.fetch("/api/auth/setup", { method: "POST", origin: HTTPS_URL, body: JSON.stringify({ password: TEST_PASSWORD, setupCode }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
    const set = res.headers.get("set-cookie")!;
    expect(set).toStartWith("__Host-lockin_host=");
    expect(set).toContain("; Secure");
    expect(set).toContain("Path=/");
    expect(set).not.toContain("Domain");
    const token = /^__Host-lockin_host=([^;]+)/.exec(set)![1]!;
    expect((await (await s.fetch("/api/auth/status", { cookie: `__Host-lockin_host=${token}` })).json()).signedIn).toBe(true);
  });

  test("the old cookie name still signs in for one release, and is swapped for the new one", async () => {
    const s = await server({ config: { publicUrl: HTTPS_URL } });
    s.app.auth.ensureSetupCode();
    await s.app.auth.setPassword(TEST_PASSWORD);
    const token = s.app.auth.createSession();
    const res = await s.fetch("/api/auth/status", { cookie: `lockin_host=${token}` });
    expect((await res.json()).signedIn).toBe(true);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`__Host-lockin_host=${token};`))).toBe(true);
    expect(cookies.some((c) => c.startsWith("lockin_host=;") && c.includes("Max-Age=0"))).toBe(true);
    // sign-out clears both names
    const out = await s.fetch("/api/auth/logout", { method: "POST", origin: HTTPS_URL, cookie: `lockin_host=${token}` });
    const cleared = out.headers.getSetCookie();
    expect(cleared.some((c) => c.startsWith("__Host-lockin_host=;"))).toBe(true);
    expect(cleared.some((c) => c.startsWith("lockin_host=;"))).toBe(true);
    expect((await (await s.fetch("/api/auth/status", { cookie: `lockin_host=${token}` })).json()).signedIn).toBe(false);
  });

  test("Bun.serve runs with development off", () => {
    const src = readFileSync(join(import.meta.dir, "../../src/server/app.ts"), "utf8");
    expect(/development:\s*false/.test(src)).toBe(true);
  });
});

// --- SA-14 ---------------------------------------------------------------------------------

describe("SA-14: a guesser on the pub Wi-Fi cannot lock everyone else out of rejoining", () => {
  function setup() {
    const r = rig();
    rigs.push(r);
    writeQuiz(r.dataDir, makeQuiz("friday", [[q(text("x"))]], { maxTeams: 30 }));
    host(r, "night.open", { quizId: "friday" });
    return r;
  }
  let connId = 60_000;
  const phone = (ip = "203.0.113.7"): Actor & { role: "team" } => ({ role: "team", teamId: null, connId: connId++, ip });
  const rejoin = (r: Rig, a: Actor, c: string) => code(r.engine.command(a, "team.rejoin", { code: c }));

  test("after 10 wrong codes from an IP, a right rejoin code and a right move code from it still work; an 11th wrong one is refused", () => {
    const r = setup();
    const a = joinTeam(r, "Quizzy Rascals");
    const b = joinTeam(r, "Les Quizerables");
    for (let i = 0; i < 10; i++) expect(rejoin(r, phone(), "AAAAAA")).toBe("bad_code");
    expect(rejoin(r, phone(), "AAAAAA")).toBe("too_many_tries");
    expect(rejoin(r, phone(), r.engine.m!.teams.get(a.teamId)!.rejoinCode)).toBe("ok");
    const mv = host(r, "team.moveCode", { teamId: b.teamId }) as { code: string };
    expect(rejoin(r, phone(), mv.code)).toBe("ok");
  });

  test("the per-connection limit still stops one socket, right code or not", () => {
    const r = setup();
    const a = joinTeam(r, "Quizzy Rascals");
    const p = phone("198.51.100.4");
    for (let i = 0; i < 5; i++) expect(rejoin(r, p, "AAAAAA")).toBe("bad_code");
    expect(rejoin(r, p, r.engine.m!.teams.get(a.teamId)!.rejoinCode)).toBe("too_many_tries");
  });

  test("an IP that keeps guessing from many sockets is stopped altogether at 60 wrong codes a minute", () => {
    const r = setup();
    const a = joinTeam(r, "Quizzy Rascals");
    for (let i = 0; i < 60; i++) rejoin(r, phone("192.0.2.66"), "AAAAAA");
    expect(rejoin(r, phone("192.0.2.66"), r.engine.m!.teams.get(a.teamId)!.rejoinCode)).toBe("too_many_tries");
    expect(rejoin(r, phone("192.0.2.67"), r.engine.m!.teams.get(a.teamId)!.rejoinCode)).toBe("ok");
    r.advance(60_001);
    expect(rejoin(r, phone("192.0.2.66"), r.engine.m!.teams.get(a.teamId)!.rejoinCode)).toBe("ok");
  });
});

// --- SA-15 ---------------------------------------------------------------------------------

describe("SA-15: team names are normalised", () => {
  function setup() {
    const r = rig();
    rigs.push(r);
    writeQuiz(r.dataDir, makeQuiz("friday", [[q(text("x"))]], { maxTeams: 30 }));
    host(r, "night.open", { quizId: "friday" });
    return r;
  }
  let connId = 70_000;
  const join = (r: Rig, name: string) => r.engine.command({ role: "team", teamId: null, connId: connId++ }, "team.join", { roomCode: r.engine.m!.night.roomCode, name });

  test("a zero-width space or a full-width letter does not make a second 'Quizzy Rascals'", () => {
    const r = setup();
    expect(join(r, "Quizzy Rascals").ok).toBe(true);
    expect(code(join(r, "Quizzy\u200B Rascals"))).toBe("team_has_phone");
    expect(code(join(r, "\uFF31uizzy Rascals"))).toBe("team_has_phone");   // full-width Q
    expect(code(join(r, "QUIZZY  RASCALS\u202E"))).toBe("team_has_phone");
  });

  test("a name of only invisible characters is refused; a stored name is cleaned", () => {
    const r = setup();
    expect(code(join(r, "\u200B\u200D\u2060\u202E"))).toBe("bad_args");
    const res = join(r, "\uFF34he \u200BQuiz\u0007ards");
    expect(res.ok).toBe(true);
    const id = (res as { result: { teamId: string } }).result.teamId;
    expect(r.engine.m!.teams.get(id)!.name).toBe("The Quizards");
  });

  test("emoji joined with ZWJ stay whole", () => {
    const r = setup();
    const res = join(r, "Family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}");
    expect(res.ok).toBe(true);
    const id = (res as { result: { teamId: string } }).result.teamId;
    expect(r.engine.m!.teams.get(id)!.name).toBe("Family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}");
  });

  test("the length counts after cleaning", () => {
    const r = setup();
    expect(join(r, "A".repeat(30) + "\u200B".repeat(20)).ok).toBe(true);
  });

  test("rename by the host uses the same rules", () => {
    const r = setup();
    joinTeam(r, "Quizzy Rascals");
    const b = joinTeam(r, "Other team");
    expect(code(r.engine.command(r.host, "team.rename", { teamId: b.teamId, name: "quizzy \u200Brascals" }))).toBe("name_taken");
    expect(code(r.engine.command(r.host, "team.rename", { teamId: b.teamId, name: "\u200B" }))).toBe("bad_args");
  });
});

// --- SA-16 ---------------------------------------------------------------------------------

describe("SA-16: CI and release", () => {
  const root = join(import.meta.dir, "../..");
  const workflows = ["ci.yml", "bun-release-check.yml", "release.yml"].map((f) => [f, readFileSync(join(root, ".github/workflows", f), "utf8")] as const);

  test("every action is pinned to a commit SHA with its tag in a comment; every workflow sets permissions", () => {
    for (const [file, text] of workflows) {
      const uses = [...text.matchAll(/uses:\s*(\S+)(.*)$/gm)];
      expect(uses.length).toBeGreaterThan(0);
      for (const [, ref, rest] of uses) {
        expect(`${file}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
        expect(`${file}: ${rest}`).toMatch(/# v\d+\.\d+\.\d+/);
      }
      expect(`${file}: ${/^permissions:\n  contents: read$/m.test(text)}`).toBe(`${file}: true`);
    }
  });

  test("a tag builds both binaries with checksums and an attestation", () => {
    const release = workflows.find(([f]) => f === "release.yml")![1];
    for (const s of ["tags:", "bun run build", "--baseline", "sha256sum", "attest-build-provenance", "gh release create"]) expect(release).toContain(s);
    expect(readFileSync(join(root, ".github/dependabot.yml"), "utf8")).toContain("github-actions");
  });

  test("LICENSE is the AGPL-3.0 and SECURITY.md points to private reporting", () => {
    expect(readFileSync(join(root, "LICENSE"), "utf8")).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).license).toBe("AGPL-3.0-only");
    expect(readFileSync(join(root, "SECURITY.md"), "utf8")).toContain("security/advisories/new");
  });
});

// --- SA-17 ---------------------------------------------------------------------------------

describe("SA-17: security events are logged, without secrets, at most once per type and IP per 10 s", () => {
  test("SecurityLog: one line, then a count of the ones held back", () => {
    const clock = new FakeClock();
    const lines: string[] = [];
    const log = new SecurityLog(clock, (m) => lines.push(m));
    log.event("sign_in_failed", "203.0.113.7");
    log.event("sign_in_failed", "203.0.113.7");
    log.event("sign_in_failed", "203.0.113.7");
    log.event("sign_in_failed", "198.51.100.1");
    log.event("sign_in_failed", "198.51.100.1");
    expect(lines).toEqual(["Security: sign_in_failed from 203.0.113.7", "Security: sign_in_failed from 198.51.100.1"]);
    clock.advance(10_001);
    log.event("sign_in_failed", "203.0.113.7", "detail\nwith a break");
    expect(lines.at(-1)).toBe("Security: sign_in_failed from 203.0.113.7: detail with a break (and 2 more like it in the last 10 s)");
    log.flush();
    expect(lines.at(-1)).toBe("Security: sign_in_failed from 198.51.100.1 (and 1 more like it in the last 10 s)");
  });

  test("sign-in, failures, the limiter, sign-out, refused sockets, pairing and teams leave lines with no secrets", async () => {
    const clock = new FakeClock();
    const s = await server({ clock });
    s.app.services.rules = fakeRules;
    s.app.services.copyPicker = fakeCopy();
    writeQuiz(s.dataDir, makeQuiz("logs", [[q(text("x"))]]));
    const setupCode = s.app.auth.ensureSetupCode();
    const bad = await s.fetch("/api/auth/setup", { method: "POST", body: JSON.stringify({ password: TEST_PASSWORD, setupCode: "WRONGWRONG" }) });
    expect(bad.status).toBe(403);
    await s.signIn();                   // setup: password_set
    const cookie = await s.signIn();    // a real sign-in
    for (let i = 0; i < 6; i++) { await s.fetch("/api/auth/login", { method: "POST", body: JSON.stringify({ password: `wrong ${i}` }) }); clock.advance(11_000); }
    const h = await connectClient(s, { role: "host", cookie });
    clients.push(h);
    await h.hello();
    const opened = await h.cmd("night.open", { quizId: "logs" });
    const roomCode = (opened as { result: { roomCode: string } }).result.roomCode;
    const tv = await connectClient(s, { role: "display" });
    clients.push(tv);
    await tv.hello();
    const st = tv.received.find((m) => m.t === "state") as { view: { pairing?: { code: string } } };
    const paired = await h.cmd("display.pair", { code: st.view.pairing!.code });
    expect(paired.ok).toBe(true);
    const t = await connectClient(s, { role: "team" });
    clients.push(t);
    await t.hello();
    const joined = await t.cmd("team.join", { roomCode, name: "Quizzy Rascals" });
    const { teamId, token } = (joined as { result: { teamId: string; token: string } }).result;
    const mv = await h.cmd("team.moveCode", { teamId });
    const moveCode = (mv as { result: { code: string } }).result.code;
    const t2 = await connectClient(s, { role: "team" });
    clients.push(t2);
    await t2.hello();
    expect((await t2.cmd("team.rejoin", { code: moveCode })).ok).toBe(true);
    expect((await h.cmd("team.remove", { teamId })).ok).toBe(true);
    expect((await h.cmd("display.unpairAll", {})).ok).toBe(true);
    const refused = await fetch(s.wsUrl.replace("ws:", "http:"), { headers: { Origin: "https://evil.example.com", Upgrade: "websocket" } });
    expect(refused.status).toBe(403);
    await s.fetch("/api/auth/logout", { method: "POST", cookie });

    const sec = s.logs.filter((l) => l.startsWith("Security: "));
    const has = (re: RegExp) => expect(sec.some((l) => re.test(l))).toBe(true);
    has(/^Security: setup_code_wrong from 127\.0\.0\.1/);
    has(/^Security: password_set from 127\.0\.0\.1/);
    has(/^Security: signed_in from 127\.0\.0\.1/);
    has(/^Security: sign_in_failed from 127\.0\.0\.1/);
    has(/^Security: limiter_tripped from 127\.0\.0\.1: sign-in/);
    has(/^Security: display_paired from 127\.0\.0\.1/);
    has(/^Security: displays_unpaired_all from 127\.0\.0\.1/);
    has(/^Security: team_joined from 127\.0\.0\.1: Quizzy Rascals/);
    has(/^Security: team_moved from 127\.0\.0\.1: Quizzy Rascals/);
    has(/^Security: team_removed from 127\.0\.0\.1: Quizzy Rascals/);
    has(/^Security: connection_refused from 127\.0\.0\.1: wrong origin/);
    has(/^Security: signed_out from 127\.0\.0\.1/);
    const session = cookie.split("=")[1]!;
    const team = s.app.db.query<{ rejoin_code: string }, []>("SELECT rejoin_code FROM teams").get()!;
    for (const secret of [TEST_PASSWORD, "wrong 0", setupCode, session, token, moveCode, roomCode, team.rejoin_code, st.view.pairing!.code]) {
      // The start-up line that prints the setup code is by design (TECH-SPEC 12.1); nothing else may.
      expect(s.logs.filter((l) => !l.startsWith("No host password is set yet.")).join("\n")).not.toContain(secret);
    }
  });

  test("a socket refused by the per-IP cap is logged", async () => {
    const s = await server();
    const data = Array.from({ length: 200 }, () => s.app.ws.admit("192.0.2.9", null)).filter(Boolean);
    const res = await fetch(s.wsUrl.replace("ws:", "http:"), { headers: { Origin: TEST_PUBLIC_URL, Upgrade: "websocket", "CF-Connecting-IP": "192.0.2.9" } });
    expect(res.status).toBe(429);
    expect(s.logs.some((l) => l.startsWith("Security: connection_refused from 192.0.2.9: too many sockets"))).toBe(true);
    for (const d of data) s.app.ws.release(d!);
  });
});

// --- SA-18 ---------------------------------------------------------------------------------

describe("SA-18: venue name and tagline are inserted as text, not replacement patterns", () => {
  const name = "The $` Arms $' $&";
  const escaped = "The $` Arms $&#39; $&amp;";
  test("phone page title and home-screen name", () => {
    const page = "<head><title>Lock-In</title><meta name=\"apple-mobile-web-app-title\" content=\"Lock-In\"></head>";
    const out = personalisePhone(page, { format: "lockin.theme/1", name, colours: {} } as never);
    expect(out).toBe(`<head><title>${escaped}</title><meta name="apple-mobile-web-app-title" content="${escaped}"></head>`);
  });
  test("display tagline", () => {
    const page = readFileSync(join(import.meta.dir, "../../public/display/index.html"), "utf8");
    const out = personaliseDisplay(page, null, name);
    expect(out).toContain(`<meta name="lockin-tagline" content="${escaped}">`);
    expect(out.length).toBe(page.length - page.match(/<meta name="lockin-tagline" content="([^"]*)">/)![1]!.length + escaped.length);
  });
});

// --- SA-19 ---------------------------------------------------------------------------------

describe("SA-19: preview.css never echoes input", () => {
  test("a crafted theme gets one fixed comment and nothing after it", async () => {
    const s = await server();
    const cookie = await s.signIn();
    const theme = encodeURIComponent('{"format":"x**//\n body{background:red} /*"}');
    const res = await s.fetch(`/api/theme/preview.css?theme=${theme}`, { cookie });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("/* This theme is not valid. */\n");
  });
});

// --- SA-21 ---------------------------------------------------------------------------------

describe("SA-21: small items", () => {
  test("fillLine ignores inherited names like {constructor}", () => {
    expect(fillLine("Hello {constructor}", { pub: "The Example Arms" } as never)).toBeNull();
    expect(fillLine("Hello {pub}", { pub: "The Example Arms" } as never)).toBe("Hello The Example Arms");
  });

  test("a .jpeg theme asset is served as image/jpeg", () => {
    const src = readFileSync(join(import.meta.dir, "../../src/server/branding/index.ts"), "utf8");
    expect(/jpeg:\s*"image\/jpeg"/.test(src)).toBe(true);
  });

  test("ws-client passes ?fixture= on only for localhost; the phone skips the service worker only there", () => {
    const ws = readFileSync(join(import.meta.dir, "../../public/shared/ws-client.js"), "utf8");
    expect(/isFixtureHost/.test(ws)).toBe(true);
    const app = readFileSync(join(import.meta.dir, "../../public/phone/app.mjs"), "utf8");
    expect(/isFixtureHost/.test(app)).toBe(true);
  });

  test("historyList answers with at most HISTORY_LIMIT nights, newest first, in one query", () => {
    const r = rig();
    rigs.push(r);
    const db = (r.engine as unknown as { d: { db: import("bun:sqlite").Database } }).d.db;
    const insert = db.prepare("INSERT INTO nights (id, quiz_id, quiz_title, quiz_snapshot, room_code, status, opened_at, ended_at, state) VALUES (?, 'q', ?, '{}', 'ABCD', 'ended', ?, ?, '{}')");
    for (let i = 0; i < 510; i++) insert.run(`n-${String(i).padStart(4, "0")}`, `Quiz ${i}`, i, i + 1);
    const list = historyList(db);
    expect(list.length).toBe(500);
    expect(list[0]!.id).toBe("n-0509");
    expect(list[0]).toEqual({ id: "n-0509", quizTitle: "Quiz 509", openedAt: 509, endedAt: 510, teams: 0, winners: [] });
  });
});
