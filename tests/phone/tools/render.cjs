// Screenshots of every phone screen for the PR (TECH-SPEC 13.3): every team view
// fixture plus the states fixtures can't show (join errors, rejoin, offline, too late,
// joker confirm, menus). Evidence for Review, not a pass/fail test.
//
//   node tests/phone/tools/render.cjs [outDir]     (default tests/phone/screens/)
//   ONLY=join node tests/phone/tools/render.cjs    (only shots whose name contains "join")
//
// Needs Playwright with Chromium (a tool, not a dependency) and Bun. Port 8081 must be free.
// /vendor/* is answered from public/vendor/ here because the fixture server has no /vendor route.
// Playwright harness for the phone: serves files from the fixture server, mocks /ws.
const { chromium } = require("playwright");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const ROOT = path.resolve(__dirname, "../../..");
const FX = JSON.parse(execFileSync("bun", [path.join(__dirname, "dump-fixtures.ts")], { cwd: ROOT, maxBuffer: 1 << 26 }).toString());
const PORT = 8081;
const clone = (x) => JSON.parse(JSON.stringify(x));
async function open(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: opts.dsf || 1, userAgent: opts.ua });
  const p = await ctx.newPage();
  const logs = [];
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(m.text()); });
  p.on("response", (r) => { if (r.status() >= 400) logs.push(r.status() + ' ' + r.url()); });
  p.on("pageerror", (e) => logs.push("pageerror " + e.message));
  await p.route("**/vendor/**", (r) => { const u = new URL(r.request().url()); r.fulfill({ path: path.join(ROOT, "public", u.pathname), contentType: "text/javascript" }); });
  const srv = { seq: 0, sent: [], ws: null, onCmd: opts.onCmd || (() => ({ ok: true, result: null })), view: opts.view };
  srv.state = (view) => { srv.view = view; srv.ws && srv.ws.send(JSON.stringify({ t: "state", seq: ++srv.seq, serverNow: FX.NOW, view })); };
  srv.drop = () => { srv.ws && srv.ws.close(); };
  srv.refuse = false;
  await p.routeWebSocket(/\/ws/, (ws) => {
    if (srv.refuse) { ws.close(); return; }
    srv.ws = ws;
    ws.onMessage((raw) => {
      const m = JSON.parse(raw);
      if (m.t === "hello") {
        srv.hello = m;
        ws.send(JSON.stringify({ t: "welcome", protocol: 1, role: "team", serverNow: FX.NOW, teamId: srv.view && srv.view.self ? srv.view.self.id : null }));
        if (srv.view) srv.state(srv.view);
      } else if (m.t === "ping") ws.send(JSON.stringify({ t: "pong", c: m.c, s: FX.NOW }));
      else if (m.t === "cmd") {
        srv.sent.push(m);
        Promise.resolve(srv.onCmd(m, srv)).then((r) => {
          if (r === null) return; // never ack
          ws.send(JSON.stringify(r.ok ? { t: "ack", id: m.id, ok: true, result: r.result } : { t: "ack", id: m.id, ok: false, error: r.error }));
        });
      }
    });
  });
  // Freeze page time at the fixture's NOW so timers read as written.
  if (opts.clock !== false) await p.clock.install({ time: FX.NOW });
  if (opts.storage) await p.addInitScript((s) => localStorage.setItem("lockin.team", JSON.stringify(s)), opts.storage);
  await p.goto(`http://localhost:${PORT}` + (opts.path || "/"));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  return { p, srv, logs, ctx };
}

const OUT = path.resolve(process.argv[2] || path.join(__dirname, "../screens"));
require("fs").mkdirSync(OUT, { recursive: true });
const V = (n) => clone(FX.views["team/" + n]);
const err = (code, message) => () => ({ ok: false, error: { code, message } });
const shots = [];
const add = (name, view, steps, opts) => shots.push({ name, view, steps, opts });
// Every fixture as it comes
for (const n of Object.keys(FX.views)) add("fixture-" + n.slice(5), clone(FX.views[n]));
// Join and its errors (P-01, P-02)
const joinErr = (code, msg) => async (p) => { await p.fill("#team-name", "Les Quizerables"); await p.click(".ph-foot .btn.primary"); await p.waitForTimeout(150); };
add("join-filled", V("lobby-join"), async (p) => { await p.fill("#team-name", "Les Quizerables"); await p.locator("#team-name").focus(); }, { path: "/j/BKTW" });
add("join-taken", V("lobby-join"), joinErr(), { path: "/j/BKTW", onCmd: err("team_has_phone", "This team already has a phone. If it died, ask for your team's rejoin code.") });
add("join-name-taken", V("lobby-join"), joinErr(), { path: "/j/BKTW", onCmd: err("name_taken", "Another team already has that name. Try another.") });
add("join-room-code", V("lobby-join"), joinErr(), { path: "/j/BKTX", onCmd: err("room_code", "That room code is not right. Check the TV.") });
add("join-full", V("lobby-join"), joinErr(), { path: "/j/BKTW", onCmd: err("night_full", "Tonight's quiz is full. Ask the quizmaster.") });
add("join-closed-error", V("lobby-join"), joinErr(), { path: "/j/BKTW", onCmd: err("joining_closed", "The quiz has started, so new teams can't join.") });
const started = V("reveal"); started.self = null;
add("join-closed", started);
add("rejoin", started, async (p) => { await p.click(".ph-foot .btn"); await p.fill("#rejoin-code", "K7PX3"); await p.click(".ph-foot .btn.primary"); });
add("rejoin-bad-code", started, async (p) => { await p.click(".ph-foot .btn"); await p.fill("#rejoin-code", "K7PX3Q"); await p.click(".ph-foot .btn.primary"); await p.waitForTimeout(150); }, { onCmd: err("bad_code", "That code doesn't match a team. Check it and try again.") });
add("move-failed", V("lobby-join"), null, { path: "/m/ABCD2345", onCmd: err("bad_code", "That move link has expired.") });
add("moved", V("asking"), async (p, srv) => { srv.ws.send(JSON.stringify({ t: "bye", reason: "moved" })); });
add("removed", V("lobby"), async (p, srv) => { srv.ws.send(JSON.stringify({ t: "bye", reason: "removed" })); });
// Lobby variants
const noStart = V("lobby"); noStart.night.plannedStart = null; noStart.night.prizes = [];
add("lobby-no-start", noStart);
add("lobby-joker-confirm", V("lobby"), async (p) => { await p.click(".joker-card .btn.joker"); });
add("menu", V("round_intro"), async (p) => { await p.click(".ph-top .icon-btn"); });
add("guide-iphone", V("lobby"), async (p) => { await p.click(".card .link"); }, { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
add("guide-android", V("lobby"), async (p) => { await p.click(".card .link"); }, { ua: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
const ri = V("round_intro"); ri.self.jokerRound = null; ri.self.jokerAvailable = true;
add("round-intro-joker", ri);
// Answer inputs (P-05)
const one = (n, over = {}) => { const v = V("asking"); const qs = V("asking-round").questions; v.questions = [Object.assign(qs[n - 1], over)]; v.answers = []; return v; };
const typed = (text) => async (p) => { const i = p.locator(".ph-body input.input").first(); await i.click(); await i.fill(text); };
const recv = (n, value) => { const v = one(n); v.answers = [{ questionId: v.questions[0].id, value, receivedAt: FX.NOW - 3000, counted: true }]; return v; };
add("q-text-received", recv(1, { type: "text", text: "Fleetwood Mac" }));
add("q-text-typing", one(1), typed("Fleetwood M"));
add("q-number-hot", one(3, { timer: { state: "running", durationMs: 60000, locksAt: FX.NOW + 7000, remainingMs: null } }), typed("4"));
add("q-year", one(5), async (p) => { await p.click('[aria-label="Year up"]'); });
add("q-date", (() => { const v = one(5); v.questions[0].input = { type: "datetime", precision: "date" }; return v; })());
add("q-time-paused", (() => { const v = one(5); v.questions[0].input = { type: "datetime", precision: "time" }; v.questions[0].timer = { state: "paused", durationMs: 60000, locksAt: null, remainingMs: 25000 }; return v; })());
add("q-image", one(4), null);
add("q-image-zoom", one(4), async (p) => { await p.click(".qimg"); });
add("q-not-started", one(1, { timer: { state: "idle", durationMs: 60000, locksAt: null, remainingMs: null } }));
add("q-too-late", one(1), async (p) => { await typed("Fleetwood Mac")(p); await p.click(".ph-foot .btn.primary"); await p.waitForTimeout(150); }, { onCmd: err("too_late", "Too late, answers were locked.") });
add("q-offline", recv(1, { type: "text", text: "Fleetwod" }), async (p, srv) => { await typed("Fleetwood Mac")(p); srv.refuse = true; srv.drop(); await p.clock.runFor(3500); });
add("asking-round-q4", V("asking-round"), async (p) => { await p.locator("nav.qnav button").nth(3).click(); });
const ar0 = V("asking"); ar0.questions = [];
add("asking-get-ready", ar0);
// Locked (P-06)
const lk = V("asking-locked"); lk.answers = [{ questionId: lk.questions[0].id, value: { type: "number", value: 4 }, receivedAt: FX.NOW - 9000, counted: true }]; lk.flash = null;
add("locked-answer", lk);
const late = V("asking-locked"); late.answers = [{ questionId: late.questions[0].id, value: { type: "number", value: 5 }, receivedAt: FX.NOW - 500, counted: false }]; late.flash = null;
add("locked-late", late);
// Score, end
const ended1 = V("ended"); ended1.self = { ...ended1.self, id: ended1.standings.rows[0].teamId, name: ended1.standings.rows[0].name, colour: ended1.standings.rows[0].colour };
add("end-winner-prize", ended1);
// Sudden death states
const sdl = V("sudden_death"); sdl.suddenDeath.status = "locked"; sdl.suddenDeath.question.status = "locked"; sdl.answers = [{ questionId: sdl.suddenDeath.question.id, value: { type: "number", value: 8 }, receivedAt: FX.NOW - 4000, counted: true }];
add("deadlock-locked", sdl);
const sdr = V("sudden_death"); sdr.suddenDeath.status = "revealed"; sdr.suddenDeath.question.status = "locked"; sdr.suddenDeath.rightIds = [sdr.self.id]; sdr.suddenDeath.outcome = { position: 1, teamIds: [sdr.self.id], result: "won" };
add("deadlock-won", sdr);
const sdw = V("sudden_death"); sdw.suddenDeath.status = "waiting"; sdw.suddenDeath.question = null;
add("deadlock-waiting", sdw);
add("deadlock-typing", V("sudden_death"), typed("8"));

(async () => {
  // The fixture server serves public/ (TECH-SPEC 13.2). The WebSocket is mocked here instead,
  // so each shot can script commands, errors and dropped connections.
  const fx = spawn("bun", ["scripts/fixture-server.ts", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1200));
  const b = await chromium.launch();
  const only = process.env.ONLY;
  const report = [];
  for (const s of shots) {
    if (only && !s.name.includes(only)) continue;
    const { p, srv, logs, ctx } = await open(b, { view: s.view, dsf: 2, ...(s.opts || {}) });
    if (s.steps) await s.steps(p, srv);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/phone-${s.name}.png` });
    const bad = logs.filter((l) => !/media\/q|Failed to load resource|theme.css|manifest/.test(l));
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const small = await p.evaluate(() => [...document.querySelectorAll("button, a, input")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 44); }).map((e) => (e.className || e.tagName) + ":" + Math.round(e.getBoundingClientRect().height)));
    report.push(`${s.name}: cmds=${srv.sent.map((c) => c.name + JSON.stringify(c.args)).join(",") || "-"}${bad.length ? " ERRORS " + bad.join(" | ") : ""}${overflow ? " H-OVERFLOW" : ""}${small.length ? " SMALL " + small.join(",") : ""}`);
    await ctx.close();
  }
  console.log(report.join("\n"));
  await b.close();
  fx.kill();
})();
