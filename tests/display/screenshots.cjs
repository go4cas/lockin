// Screenshots of every display fixture at 1920x1080 and 1280x720 (TECH-SPEC 13.3).
// Evidence for Review, not a pass/fail test (bun test does not run this file).
//
//   bun run fixtures --port 8091 &
//   node tests/display/screenshots.cjs [baseUrl] [outDir]   (default outDir: docs/screenshots/b6)
//
// Needs Playwright with Chromium on the machine (a tool, not a dependency).
// Until the routes exist on main, /vendor/*, /qr/join.svg (B8) and /media/q/* (B1)
// are answered here from disk or with a placeholder, the same way the real server will.
const { chromium } = require("../../tools/browser/playwright.cjs");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const BASE = process.argv[2] || "http://localhost:8091";
const OUT = path.resolve(process.argv[3] || path.join(ROOT, "docs/screenshots/b6"));

/** A made-up venue logo, served at /theme/assets/ for the logo shots. */
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><rect x="4" y="4" width="312" height="112" rx="20" fill="none" stroke="#e2cfa6" stroke-width="8"/><text x="160" y="76" font-size="44" text-anchor="middle" font-family="Georgia" fill="#e2cfa6">Example Arms</text></svg>`;

const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#3a4a5c"/><circle cx="200" cy="200" r="120" fill="#e2cfa6"/><rect x="40" y="300" width="320" height="18" fill="#17191b"/><text x="200" y="215" font-size="36" text-anchor="middle" font-family="Arial" fill="#17191b">picture</text></svg>`;

/** Fixture name -> how long to wait before the shot (ms), and extra shots at other times. */
const SHOTS = {
  "display/leaderboard": [[3500, "mid-reveal"], [8000, ""]],
  "display/leaderboard-20": [[21000, ""]],
  "display/leaderboard-30": [[6000, "page-21-30"], [36000, ""]],
  "display/ended": [[2500, "winner"], [17000, "final"]],
  "display/asking-locked": [[400, "snap"], [2500, ""]],
  "display/lobby-holding": [0, 1, 2, 3, 4, 5].map((i) => [2500 + i * 12000, "panel-" + (i + 1)]),
};

/** Extra screens with no fixture of their own: a fixture's view, changed before the page gets it. */
const LONG = "This harbour city sits at the foot of a flat-topped mountain, and its stadium was built for a World Cup. Ferries leave from its waterfront for an island prison. Name the city that we are describing.";
const VARIANTS = {
  "question-long": ["display/asking", (v) => { v.question.text = LONG; v.question.input = { type: "text" }; v.lines.question = null; }],
  "question-image-long": ["display/asking-image", (v) => { v.question.text = LONG.replace("that we are describing", "in the photo"); }],
  "question-paused": ["display/asking", (v) => { v.question.timer = { state: "paused", durationMs: 60000, locksAt: null, remainingMs: 30000 }; }],
  "question-at-zero": ["display/asking", (v, now) => { v.question.timer = { state: "running", durationMs: 60000, locksAt: now - 500, remainingMs: null }; v.question.answered = 5; }],
  "reveal-text": ["display/reveal", (v) => { v.reveal.question.text = "Which band released the album 'Rumours' in 1977?"; v.reveal.question.input = { type: "text" }; v.reveal.answerText = "Fleetwood Mac"; }],
  "deadlock-intro": ["display/sudden_death", (v) => { v.suddenDeath.status = "waiting"; v.suddenDeath.question = null; }],
  "deadlock-locked": ["display/sudden_death", (v, now) => { v.suddenDeath.status = "locked"; v.suddenDeath.question.status = "locked"; v.lockedMoment = { at: now - 200, all: false }; v.lines.locked = "Answers locked. No take-backs."; }],
  "deadlock-shared": ["display/sudden_death-revealed", (v) => { v.suddenDeath.questionNumber = 3; v.suddenDeath.rightIds = []; v.suddenDeath.outcome = { position: 1, teamIds: v.suddenDeath.teams.map((t) => t.id), result: "shared" }; v.lines.suddenDeath = "Still deadlocked. You'll have to share it."; }],
  "winner-shared": ["display/ended", (v) => { v.final.winners = v.teams.slice(0, 2); v.lines.winner = "Joint champions: Quizteama Aguilera and Les Quizerables!"; }],
  "idle-no-name": ["display/idle", (v) => { v.venue.name = ""; }],
  // venue afterWinner "host": still the winner long after the timer would have moved on
  "winner-waiting-for-host": ["display/ended", (v) => { v.final.standingsAt = null; }, { waits: [[17000, ""]] }],
  // A venue logo and tagline filled in by GET /display (the fixture server serves the page as it is)
  "idle-logo": ["display/idle", null, { logo: true }],
  "leaderboard-logo": ["display/leaderboard", null, { logo: true, waits: [[8000, ""]] }],
  "lobby-30": ["display/lobby", (v) => { v.flash = null; v.teams = Array.from({ length: 30 }, (_, i) => ({ id: "t" + i, name: v.teams[i % 6].name + (i >= 6 ? " " + (Math.floor(i / 6) + 1) : ""), colour: (i % 8) + 1, jokerThisRound: false })); }],
};

async function routes(page, state, mutate, opts) {
  if (opts && opts.logo) {
    // Fill the meta tags as GET /display would (the fixture server serves the page as it is).
    await page.addInitScript(() => {
      new MutationObserver((list) => {
        for (const m of list) for (const n of m.addedNodes) {
          if (n.nodeName !== "META") continue;
          if (n.getAttribute("name") === "lockin-logo") n.setAttribute("content", "/theme/assets/logo-example.svg");
          if (n.getAttribute("name") === "lockin-tagline") n.setAttribute("content", "Think fast. Drink slow.");
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.route(/\/theme\/assets\//, (r) => r.fulfill({ body: LOGO, contentType: "image/svg+xml" }));
  }
  await page.route(/\/vendor\//, (r) => {
    const p = new URL(r.request().url()).pathname;
    r.fulfill({ path: path.join(ROOT, "public", p), contentType: "text/javascript" });
  });
  await page.route(/\/qr\/join\.svg/, (r) => r.fulfill({ body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path d="M2 2h7v7H2zM20 2h7v7h-7zM2 20h7v7H2z" fill="#000"/></svg>', contentType: "image/svg+xml" }));
  await page.route(/\/media\/q\//, (r) => r.fulfill({ body: PICTURE, contentType: "image/svg+xml" }));
  if (mutate) {
    await page.routeWebSocket(/\/ws/, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((m) => {
        const msg = JSON.parse(m);
        if (msg.t === "state") mutate(msg.view, msg.serverNow);
        ws.send(JSON.stringify(msg));
      });
      ws.onMessage((m) => server.send(m));
    });
  }
  if (state) {
    await page.routeWebSocket(/\/ws/, (ws) => {
      if (state.offline) { ws.close(); return; }
      ws.connectToServer();
      state.sockets.push(ws);
    });
  }
}

async function shoot(browser, name, w, h, waits, variant) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await routes(page, null, variant && variant[1], variant && variant[3]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/theme\.css|favicon|404/.test(m.text())) errors.push(m.text()); });
  const started = Date.now();
  await page.goto(`${BASE}/display?fixture=${encodeURIComponent(name)}`);
  await page.evaluate(() => document.fonts.ready);
  for (const [at, label] of waits) {
    const wait = at - (Date.now() - started);
    if (wait > 0) await page.waitForTimeout(wait);
    const file = `${variant ? variant[2] : name.replace("display/", "")}${label ? "--" + label : ""}--${w}x${h}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    const scroll = await page.evaluate(() => ({ x: document.documentElement.scrollWidth > innerWidth, y: document.documentElement.scrollHeight > innerHeight }));
    if (scroll.x || scroll.y) errors.push(`page scrolls: ${JSON.stringify(scroll)}`);
    const code = await page.evaluate(() => /=>|renderTemplate/.test(document.body.innerText));
    if (code) errors.push("source code printed on screen (an Arrow slot that held text got a template)");
  }
  await page.close();
  return errors;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const list = await (await fetch(`${BASE}/fixtures`)).text();
  const names = [...list.matchAll(/fixture=(display%2F[^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
  const browser = await chromium.launch();
  const report = {};
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    await Promise.all(names.map(async (name) => {
      const errs = await shoot(browser, name, w, h, SHOTS[name] || [[2500, ""]]);
      if (errs.length) report[`${name} ${w}x${h}`] = errs;
    }));
    await Promise.all(Object.entries(VARIANTS).map(async ([label, [base, mutate, opts]]) => {
      const errs = await shoot(browser, base, w, h, (opts && opts.waits) || [[2500, ""]], [base, mutate, label, opts]);
      if (errs.length) report[`${label} ${w}x${h}`] = errs;
    }));

    // Reconnecting (T-11): drop the socket and refuse reconnects for a few seconds.
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const state = { offline: false, sockets: [] };
    await routes(page, state);
    await page.goto(`${BASE}/display?fixture=display%2Fasking`);
    await page.waitForTimeout(1500);
    state.offline = true;
    for (const s of state.sockets) s.close();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT, `reconnecting--${w}x${h}.png`) });
    state.offline = false;
    await page.waitForTimeout(6500);
    const back = await page.evaluate(() => !document.querySelector(".reconnect"));
    await page.screenshot({ path: path.join(OUT, `reconnected--${w}x${h}.png`) });
    if (!back) report[`reconnect ${w}x${h}`] = ["still showing Reconnecting after the server came back"];
    await page.close();

    // Browser too old (T-01): the check forced to fail by removing replaceChildren.
    const old = await browser.newPage({ viewport: { width: w, height: h } });
    await routes(old);
    await old.addInitScript(() => { delete Element.prototype.replaceChildren; });
    await old.goto(`${BASE}/display?fixture=display%2Fasking`);
    await old.waitForTimeout(1500);
    await old.screenshot({ path: path.join(OUT, `too-old--${w}x${h}.png`) });
    const shown = await old.evaluate(() => !!document.querySelector(".too-old") && !document.querySelector(".display-screen"));
    if (!shown) report[`too-old ${w}x${h}`] = ["the too-old message did not show, or the display still rendered"];
    await old.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  console.log(`Screenshots in ${OUT}`);
})();
