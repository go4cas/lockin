// Design review screenshots: every page and state of every client, against a real
// server and a realistic quiz, at the sizes people use (phone 390x844, display
// 1920x1080, console 1280x800 and tablet 768x1024). Writes the PNGs and an INDEX.md.
// A Playwright tool like browser-night.ts, not a check: it fails only when a step
// cannot be reached, and it lists page errors it saw at the end of the index.
//
//   bun tests/e2e/design-shots.ts [outDir] [default|branded]
//
// "default" walks a whole night in the out-of-the-box theme; "branded" walks a short
// night with a made-up venue theme, to show what branding changes.

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "../../tools/browser/playwright.mjs";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type Question, type QuizFile } from "../../src/shared/formats.ts";
import type { HostView } from "../../src/shared/protocol.ts";
import { writeQuiz } from "../night/fakes.ts";
import { startProcess, tempDataDir } from "../helpers/process.ts";
import { TEST_PASSWORD } from "../helpers/server.ts";
import { Night, ok, waitFor, type Labelled } from "./driver.ts";

const OUT = process.argv[2] ?? join(import.meta.dir, "../../dist/design-shots");
const MODE = (process.argv[3] ?? "default") as "default" | "branded";
const PORT = 18000 + Math.floor(Math.random() * 2000);
const PUBLIC = `http://127.0.0.1:${PORT}`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ the quiz

const R1: Question[] = [
  { id: "q-gk000001", text: "Which band recorded the 1977 album Rumours?", answer: { type: "text", accepted: ["Fleetwood Mac"] } },
  { id: "q-gk000002", text: "What is the capital of Norway?", answer: { type: "choice", options: ["Bergen", "Oslo", "Stockholm", "Trondheim"], correct: 1 } },
  { id: "q-gk000003", text: "Which country's flag is this?", answer: { type: "text", accepted: ["Japan"] }, media: { kind: "image", file: "q-gk000003.png", alt: "A white flag with a red circle in the middle" } },
  { id: "q-gk000004", text: "How many players are on the pitch for one side in a rugby union match?", answer: { type: "number", value: 15 } },
  { id: "q-gk000005", text: "In which year did the Berlin Wall fall?", answer: { type: "datetime", precision: "year", value: "1989", scoring: "exact" } },
];
const R2: Question[] = [
  { id: "q-mf000001", text: "Which 1994 film, directed by Robert Zemeckis, follows a kind-hearted man from Alabama who finds himself at the centre of several defining moments in American history?", answer: { type: "text", accepted: ["Forrest Gump"] } },
  { id: "q-mf000002", text: "Which of these was never a member of the Beatles?", answer: { type: "choice", options: ["George Harrison", "Pete Best", "Mick Jagger", "Stuart Sutcliffe", "Ringo Starr", "Paul McCartney"], correct: 2 } },
  { id: "q-mf000003", text: "How many UK number-one singles did Elvis Presley have? Closest wins.", answer: { type: "closest", value: 21 } },
  { id: "q-mf000004", text: "On what date did the first Harry Potter film premiere in London?", answer: { type: "datetime", precision: "date", value: "2001-11-04", scoring: "exact" } },
  { id: "q-mf000005", text: "Who composed the music for Jaws, Star Wars and Indiana Jones?", answer: { type: "text", accepted: ["John Williams"] }, timerSeconds: 15 },
];
const SD: Question = { id: "q-sd000001", text: "How tall is the Eiffel Tower in metres, to the tip?", answer: { type: "closest", value: 330 } };
const quiz: QuizFile = {
  format: QUIZ_FORMAT, id: "thursday-quiz", title: "Thursday Night Quiz", updatedAt: "2026-11-24T10:00:00.000Z",
  settings: { ...DEFAULT_QUIZ_SETTINGS, lockMode: "question", timerSeconds: 45, joker: true, halftimeAfterRound: 1 },
  rounds: [
    { id: "r-gk000001", title: "General Knowledge", questions: R1 },
    { id: "r-mf000001", title: "Music and Film", questions: R2 },
  ],
  suddenDeath: [SD],
};
const roundQuiz: QuizFile = {
  ...quiz, id: "round-lock-quiz", title: "Christmas Special (answers per round)",
  settings: { ...quiz.settings, lockMode: "round", halftimeAfterRound: "none" },
  rounds: [{ id: "r-xm000001", title: "Festive Films", questions: [
    { id: "q-xm000001", text: "In Home Alone, where are the McCallisters flying to?", answer: { type: "text", accepted: ["Paris"] } },
    { id: "q-xm000002", text: "Which actor plays Buddy in Elf?", answer: { type: "choice", options: ["Will Ferrell", "Jim Carrey", "Adam Sandler"], correct: 0 } },
    { id: "q-xm000003", text: "How many ghosts visit Scrooge, counting Marley?", answer: { type: "number", value: 4 } },
  ] }],
  suddenDeath: [],
};
const draftQuiz = {
  format: QUIZ_FORMAT, id: "music-draft", title: "Music Bingo (draft)", updatedAt: "2026-11-23T18:00:00.000Z",
  settings: { ...DEFAULT_QUIZ_SETTINGS },
  rounds: [{ id: "r-dr000001", title: "Number Ones", questions: [
    { id: "q-dr000001", text: "Who sang Bohemian Rhapsody?", answer: { type: "text", accepted: ["Queen"] } },
    { id: "q-dr000002", text: "", answer: { type: "choice", options: ["", ""], correct: -1 } },
  ] }],
  suddenDeath: [],
};

// Who answers what: [round][question] -> true (right), a string/number (that answer), or false (a wrong one).
type Plan = (boolean | string | number)[][];
const BROWSER_TEAMS: Record<string, Plan> = {
  "Quizteama Aguilera": [[true, true, true, true, true], [true, true, true, true, true]],
  "Les Quizerables": [["Fleetwood Mack", true, true, true, true], [true, true, true, true, true]],
  "The Fellowship of the Pint": [[true, true, "Bangladesh", true, false], [true, false, 18, false, true]],
  "Agatha Quiztie": [[false, true, false, false, true], ["Forest Gump", false, false, false, false]],
};
const PROTOCOL_TEAMS: Record<string, Plan> = {
  "Universally Challenged": [[true, true, true, false, true], [true, true, 20, false, false]],
  "Tequila Mockingbird": [[true, false, true, true, false], [false, true, false, true, false]],
  "Trivia Newton-John": [[false, false, true, false, false], [true, false, false, false, true]],
  "Quiz Khalifa": [[true, true, false, true, true], [true, true, 25, false, false]],
};

function right(q: Question): string | number {
  const a = q.answer;
  return a.type === "text" ? a.accepted[0]! : a.type === "choice" ? a.correct : a.type === "datetime" ? a.value : (a as { value: number }).value;
}
function wrong(q: Question): string | number {
  const a = q.answer;
  if (a.type === "text") return "No idea";
  if (a.type === "choice") return (a.correct + 1) % a.options.length;
  if (a.type === "datetime") return a.precision === "year" ? String(Number(a.value) + 2) : "2001-07-15";
  return (a as { value: number }).value + 4;
}
const answerFor = (plan: Plan, r: number, i: number, q: Question) => {
  const p = plan[r]![i]!;
  return p === true ? right(q) : p === false ? wrong(q) : p;
};

/** The protocol shape of an answer (rules-api AnswerValue). */
function wire(q: Question, v: string | number) {
  const t = q.answer.type;
  if (t === "text") return { type: "text", text: String(v) };
  if (t === "choice") return { type: "choice", index: Number(v) };
  if (t === "datetime") return { type: "datetime", value: String(v) };
  return { type: "number", value: Number(v) };
}

// ------------------------------------------------------------------ pictures

async function flagPng(browser: Browser): Promise<Uint8Array> {
  const p = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await p.setContent(`<body style="margin:0;background:#fff"><div style="width:1200px;height:800px;display:flex;align-items:center;justify-content:center"><div style="width:480px;height:480px;border-radius:50%;background:#bc002d"></div></div></body>`);
  const png = await p.screenshot({ type: "png" });
  await p.close();
  return png;
}

// ------------------------------------------------------------------ capture plumbing

interface Client { name: string; folder: string; page: Page; full: boolean }
const clients: Client[] = [];
const problems: string[] = [];
const index: { step: string; note: string; files: string[] }[] = [];
let restarting = false;
let n = 0;

function watch(c: Client) {
  c.page.on("pageerror", (e) => problems.push(`${c.name}: page error: ${e.message}`));
  c.page.on("console", (m) => { if (m.type() === "error" && !(restarting && /WebSocket|ERR_CONNECTION/i.test(m.text()))) problems.push(`${c.name}: console error: ${m.text()}`); });
  clients.push(c);
}

/** Screenshots of the named clients (default: all) for one step. */
async function snap(step: string, note: string, only?: (c: Client) => boolean, settle = 500) {
  n++;
  await Bun.sleep(settle);
  const files: string[] = [];
  for (const c of clients) {
    if (only && !only(c)) continue;
    if (c.page.isClosed()) continue;
    const file = `${c.folder}/${String(n).padStart(3, "0")}-${step}${c.folder === "phone" ? `--${c.name.replace(/\W+/g, "-").toLowerCase()}` : ""}.png`;
    mkdirSync(join(OUT, c.folder), { recursive: true });
    if (c.full) {
      // Grow the viewport to the page so sticky parts (the run footer) sit where a person
      // scrolled to the bottom would see them, not over the middle of a long page.
      const size = c.page.viewportSize();
      const h = await c.page.evaluate(() => document.documentElement.scrollHeight);
      if (size && h > size.height) await c.page.setViewportSize({ width: size.width, height: h });
      await c.page.screenshot({ path: join(OUT, file) });
      if (size && h > size.height) await c.page.setViewportSize(size);
    } else await c.page.screenshot({ path: join(OUT, file) });
    files.push(file);
  }
  index.push({ step: `${String(n).padStart(3, "0")} ${step}`, note, files });
  console.log(`${n} ${step} (${files.length})`);
}
const isDisplay = (c: Client) => c.folder === "display";
const isConsole = (c: Client) => c.folder.startsWith("console");
const isPhone = (c: Client) => c.folder === "phone";
const named = (...names: string[]) => (c: Client) => names.includes(c.name);
const or = (...fs: ((c: Client) => boolean)[]) => (c: Client) => fs.some((f) => f(c));

async function newContext(browser: Browser, kind: "display" | "console-1280" | "console-768" | "phone"): Promise<BrowserContext> {
  if (kind === "display") return browser.newContext({ viewport: { width: 1920, height: 1080 } });
  if (kind === "console-1280") return browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (kind === "console-768") return browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
}

// ------------------------------------------------------------------ the walk

async function main() {
  const browser = await chromium.launch();
  const dataDir = tempDataDir("lockin-design-");
  const flag = await flagPng(browser);
  writeQuiz(dataDir, quiz, { "q-gk000003.png": flag });
  writeQuiz(dataDir, roundQuiz);
  writeQuiz(dataDir, draftQuiz as unknown as QuizFile);
  writeFileSync(join(dataDir, "venue.json"), JSON.stringify({
    format: "lockin.venue/1",
    prizes: [{ place: 1, text: "£50 bar tab" }, { place: 2, text: "A bottle of house red" }, { place: 3, text: "Bragging rights" }],
    holding: { minutesBefore: 30, panels: ["countdown", "teams", "join", "install", "poster", "prizes"] },
    afterWinner: { mode: "host", seconds: 15 },
  }, null, 2));
  if (MODE === "branded") {
    mkdirSync(join(dataDir, "theme", "assets"), { recursive: true });
    writeFileSync(join(dataDir, "theme", "assets", "logo.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="94" fill="#d9a441"/><circle cx="100" cy="100" r="80" fill="none" stroke="#1f2a24" stroke-width="6"/><path d="M52 70 L78 48 L92 80 L108 80 L122 48 L148 70 L132 120 L100 150 L68 120 Z" fill="#1f2a24"/></svg>`);
    copyFileSync(join(import.meta.dir, "pub-picture.jpg"), join(dataDir, "theme", "assets", "tv-picture.jpg"));
    // The holding page's Poster panel shows a venue picture (UI-22).
    copyFileSync(join(import.meta.dir, "pub-picture.jpg"), join(dataDir, "theme", "assets", "poster.jpg"));
    writeFileSync(join(dataDir, "venue.json"), JSON.stringify({
      format: "lockin.venue/1", prizes: [{ place: 1, text: "£50 bar tab" }],
      holding: { minutesBefore: 30, panels: ["poster", "countdown", "join"], panelSeconds: 12, poster: "assets/poster.jpg" },
      afterWinner: { mode: "host", seconds: 15 },
    }, null, 2));
    writeFileSync(join(dataDir, "theme", "theme.json"), JSON.stringify({
      format: "lockin.theme/1", name: "The Crooked Fox", logo: "assets/logo.svg",
      // background/text/accent2 and fonts are pre-Last Call keys: still accepted, ignored.
      colours: { background: "#1f2a24", text: "#f3ead7", accent: "#d9a441", accent2: "#7fc4a8" },
      fonts: { display: { bundled: "alfa-slab-one" }, body: { bundled: "atkinson-hyperlegible" } },
      countdown: "bar",
      displayBackground: { image: "assets/tv-picture.jpg" }, copy: {},
    }, null, 2));
  }

  const night = new Night(dataDir, { port: PORT, publicUrl: PUBLIC });
  night.p = await startProcess({ dataDir, port: PORT, publicUrl: PUBLIC });

  // --- consoles and display before sign-in ------------------------------------------------
  const c1280 = await newContext(browser, "console-1280");
  const c768 = await newContext(browser, "console-768");
  const con = { name: "console", folder: "console-1280", page: await c1280.newPage(), full: true };
  const tab = { name: "console-tablet", folder: "console-768", page: await c768.newPage(), full: true };
  watch(con); watch(tab);
  const displayCtx = await newContext(browser, "display");
  const disp = { name: "display", folder: "display", page: await displayCtx.newPage(), full: false };
  watch(disp);

  if (MODE === "default") {
    const old = await (await newContext(browser, "display")).newPage();
    await old.addInitScript(() => { try { delete (Element.prototype as unknown as Record<string, unknown>).replaceChildren; } catch { /* */ } });
    await old.goto(`${PUBLIC}/display`);
    await old.waitForSelector(".too-old", { timeout: 5000 });
    mkdirSync(join(OUT, "display"), { recursive: true });
    n++;
    await old.screenshot({ path: join(OUT, "display", `${String(n).padStart(3, "0")}-browser-too-old.png`) });
    index.push({ step: `${String(n).padStart(3, "0")} browser-too-old`, note: "Display: the page an old TV browser gets instead of the quiz.", files: [`display/${String(n).padStart(3, "0")}-browser-too-old.png`] });
    await old.context().close();

    for (const c of [con, tab]) await c.page.goto(`${PUBLIC}/host/setup`);
    await disp.page.goto(`${PUBLIC}/display`);
    await disp.page.waitForSelector(".pair-code", { timeout: 5000 });
    await snap("first-run-setup", "Console: first run, setting the host password with the setup code from the server log. Display: waiting to be paired (shows a pairing code).", or(isConsole, isDisplay));
  } else {
    await disp.page.goto(`${PUBLIC}/display`);
    await disp.page.waitForSelector(".pair-code", { timeout: 5000 });
  }
  night.cookie = await night.p.signIn();
  for (const c of [con, tab]) await c.page.goto(`${PUBLIC}/host/run`);
  await con.page.waitForSelector("#login-form #password", { timeout: 5000 });
  if (MODE === "default") await snap("sign-in", "Console: the sign-in page.", isConsole);
  await con.page.fill("#password", TEST_PASSWORD);
  await con.page.click("#login-form button[type=submit]");
  await con.page.waitForSelector(".pair-input", { timeout: 5000 });
  const cookies = await c1280.cookies();
  await c768.addCookies(cookies);
  night.host = await night.client("host", "host");
  night.display = await night.client("display", "display");

  // --- console: home, library, builder, branding ------------------------------------------
  if (MODE === "default") {
    for (const c of [con, tab]) await c.page.goto(`${PUBLIC}/host`);
    await snap("console-home", "Console: home page after sign-in.", isConsole);
    for (const c of [con, tab]) { await c.page.goto(`${PUBLIC}/host/build`); await c.page.waitForSelector("table, .lib-title", { timeout: 5000 }); }
    await snap("library", "Console: the quiz library with a ready quiz, a round-lock quiz and an unfinished draft.", isConsole);
    for (const c of [con, tab]) {
      const more = c.page.locator('button[aria-haspopup], button:has-text("⋯")').first();
      if (await more.count()) await more.click();
    }
    await snap("library-row-menu", "Console: a quiz's row menu (duplicate, rename, delete).", isConsole);
    for (const c of [con, tab]) {
      const del = c.page.locator('[role=menuitem]:has-text("Delete")').first();
      if (await del.count()) await del.click();
    }
    await snap("library-delete-dialog", "Console: confirm before deleting a quiz.", isConsole);
    for (const c of [con, tab]) { await c.page.goto(`${PUBLIC}/host/build`); await c.page.waitForSelector(".lib-title", { timeout: 5000 }); await c.page.click('button:has-text("New quiz")'); }
    await snap("library-new-quiz-dialog", "Console: naming a new quiz.", isConsole);

    const builder = async (step: string, note: string, quizId: string, ...clicks: string[]) => {
      for (const c of [con, tab]) {
        await c.page.goto(`${PUBLIC}/host/build?quiz=${quizId}`);
        await c.page.waitForSelector(".b-side", { timeout: 5000 });
        for (const click of clicks) { await c.page.locator(click).first().click(); await Bun.sleep(150); }
      }
      await snap(step, note, isConsole);
    };
    await builder("builder-quiz-settings", "Builder: quiz title and night settings (lock mode, timer, halftime, joker, sudden death).", quiz.id, '.b-side a:has-text("Quiz and settings")');
    await builder("builder-round", "Builder: a round with its question list.", quiz.id, '.b-side a:has-text("General Knowledge")');
    await builder("builder-question-text", "Builder: a free-text question with accepted answers.", quiz.id, '.b-side a:has-text("General Knowledge")', '.b-side a:has-text("Q1")');
    await builder("builder-question-choice", "Builder: a multiple-choice question.", quiz.id, '.b-side a:has-text("General Knowledge")', '.b-side a:has-text("Q2")');
    await builder("builder-question-picture", "Builder: a picture question.", quiz.id, '.b-side a:has-text("General Knowledge")', '.b-side a:has-text("Q3")');
    await builder("builder-question-number", "Builder: a number question.", quiz.id, '.b-side a:has-text("General Knowledge")', '.b-side a:has-text("Q4")');
    await builder("builder-question-year", "Builder: a year (date/time) question.", quiz.id, '.b-side a:has-text("General Knowledge")', '.b-side a:has-text("Q5")');
    await builder("builder-sudden-death", "Builder: the sudden-death questions.", quiz.id, '.b-side a:has-text("Sudden death")');
    await builder("builder-draft-problems", "Builder: an unfinished quiz with its list of problems.", draftQuiz.id);
    await builder("builder-draft-empty-question", "Builder: an empty multiple-choice question in a draft.", draftQuiz.id, '.b-side a:has-text("Number Ones")', '.b-side a:has-text("Q2")');

    for (const [tabName, label] of [["branding", "Branding"], ["holding", "Holding page"], ["prizes", "Prizes"]] as const) {
      for (const c of [con, tab]) {
        await c.page.goto(`${PUBLIC}/host/brand`);
        await c.page.waitForSelector('[role=tab]', { timeout: 5000 });
        await c.page.click(`[role=tab]:has-text("${label}")`);
      }
      await snap(`venue-settings-${tabName}`, `Console: venue settings, ${label} tab.`, isConsole, 900);
    }
    for (const c of [con, tab]) { await c.page.goto(`${PUBLIC}/host/history`); }
    await snap("history-empty", "Console: history before any night has run.", isConsole);
  } else {
    for (const c of [con, tab]) { await c.page.goto(`${PUBLIC}/host/brand`); await c.page.waitForSelector('[role=tab]', { timeout: 5000 }); }
    await snap("venue-settings-branding", "Console: branding tab with a venue theme saved.", isConsole, 900);
  }

  // --- pairing -----------------------------------------------------------------------------
  for (const c of [con, tab]) { await c.page.goto(`${PUBLIC}/host/run`); await c.page.waitForSelector(".pair-input", { timeout: 5000 }); }
  const pairCode = (await disp.page.textContent(".pair-code"))!.trim();
  await con.page.fill(".pair-input", pairCode);
  await snap("run-idle-pairing", "Console: Run night with no night open, the pairing code typed in. Display: its pairing code.", or(isConsole, isDisplay));
  await con.page.click(".pair-card button[type=submit]");
  await disp.page.waitForFunction(() => !document.querySelector(".pair-code"), null, { timeout: 5000 });
  await snap("idle-paired", "Display: paired, no night open (the venue's waiting screen). Console: display paired.", or(isConsole, isDisplay), 1200);

  // --- lobby -----------------------------------------------------------------------------
  const { roomCode } = await night.cmd("night.open", { quizId: quiz.id }) as { roomCode: string };
  await disp.page.waitForFunction((code) => document.body.innerText.includes(code), roomCode, { timeout: 5000 });
  const joinPath = new URL(night.hostView().night!.joinUrl).pathname;

  // phones
  const phones: { name: string; c: Client }[] = [];
  const names = Object.keys(BROWSER_TEAMS);
  for (const name of names) {
    const ctx = await newContext(browser, "phone");
    const c = { name, folder: "phone", page: await ctx.newPage(), full: true };
    watch(c);
    await c.page.goto(`${PUBLIC}${joinPath}`);
    await c.page.waitForSelector("#team-name", { timeout: 5000 });
    phones.push({ name, c });
  }
  const p0 = phones[0]!.c;
  await snap("lobby-empty", "Lobby, no teams yet. Phone: the join page opened from the QR code (room code filled in).", or(isConsole, isDisplay, named(p0.name)));
  await p0.page.fill("#team-name", phones[0]!.name);
  await snap("join-filled", "Phone: join page with a team name typed.", named(p0.name), 200);

  // a blank-link join page, and a taken name
  const extraCtx = await newContext(browser, "phone");
  const extra = { name: "new-phone", folder: "phone", page: await extraCtx.newPage(), full: true };
  watch(extra);
  await extra.page.goto(`${PUBLIC}/`);
  await extra.page.waitForSelector("#team-name", { timeout: 5000 });
  await snap("join-typed-url", "Phone: the join page opened by typing the address (room code empty).", named("new-phone"));

  for (const { name, c } of phones) {
    await c.page.fill("#team-name", name);
    await c.page.click(".ph-foot .btn.primary:visible");
    await c.page.waitForFunction((nm) => document.querySelector(".ph-top .team")?.textContent === nm, name, { timeout: 5000 });
  }
  await extra.page.fill("#team-name", phones[0]!.name);
  await extra.page.fill("#room-code", "ZZZZ");
  await extra.page.click(".ph-foot .btn.primary:visible");
  await snap("join-error-room-code", "Phone: join error, wrong room code.", named("new-phone"), 800);
  await extra.page.fill("#room-code", roomCode);
  await extra.page.click(".ph-foot .btn.primary:visible");
  await snap("join-error-name-taken", "Phone: join error, a team with that name already has a phone.", named("new-phone"), 800);
  await extra.page.click('button:has-text("rejoin code")').catch(() => {});
  await snap("rejoin-code", "Phone: the rejoin-code page.", named("new-phone"), 400);
  clients.splice(clients.indexOf(extra), 1);
  await extraCtx.close();

  const proto: { name: string; c: Labelled; teamId: string }[] = [];
  for (const name of Object.keys(PROTOCOL_TEAMS)) {
    const ph = await night.join(roomCode, name);
    proto.push({ name, c: ph.c, teamId: ph.teamId });
  }
  await waitFor<HostView>(night.host, (v) => v.teams.length === 8 && v.teams.every((t) => t.connected), "8 teams");
  await snap("lobby-8-teams", "Lobby with 8 teams. Phones: You're in, joker offer, prizes, add-to-home-screen card.", or(isConsole, isDisplay, isPhone), 1200);

  await p0.page.click(".ph-top .icon-btn:visible");
  await snap("phone-team-menu", "Phone: the team menu (rejoin code, joker status, add to home screen).", named(p0.name), 400);
  await p0.page.click('.sheet .btn.secondary:has-text("Close")');
  await p0.page.click('button:has-text("Show me")');
  await p0.page.click('[role=tab]:has-text("iPhone")');
  await snap("phone-home-screen-guide-ios", "Phone: add-to-home-screen guide, iPhone tab.", named(p0.name), 400);
  await p0.page.click('[role=tab]:has-text("Android")');
  await snap("phone-home-screen-guide-android", "Phone: add-to-home-screen guide, Android tab.", named(p0.name), 400);
  await p0.page.click('.sheet .btn.secondary:has-text("Done")');

  // holding page: a planned start 20 minutes from now
  await night.cmd("night.update", { plannedStart: Date.now() + 20 * 60_000 });
  await snap("holding-page", "Lobby with a planned start: the display's holding page (panels take turns), phone countdown.", or(isConsole, isDisplay, named(p0.name)), 1500);
  if (MODE === "default") {
    for (let k = 1; k <= 5; k++) {
      await Bun.sleep(12_000);
      await snap(`holding-page-panel-${k + 1}`, "Display: the holding page's next panel (12 seconds each).", isDisplay, 100);
    }
  }
  await night.cmd("night.update", { plannedStart: null });

  // joker, played by the Fellowship on round 1
  const fellowship = phones[2]!.c;
  await fellowship.page.click(".joker-card .btn.joker");
  await snap("joker-confirm", "Phone: confirming the joker.", named(fellowship.name), 300);
  await fellowship.page.click(".joker-card .btn.joker");
  await waitFor<HostView>(night.host, (v) => v.teams.find((t) => t.name === fellowship.name)!.jokerRound === 0, "joker played", 5000);
  await snap("joker-played", "Phone: after playing the joker.", named(fellowship.name), 400);
  await ok(proto[3]!.c, "joker.play", { round: 0 });

  await night.cmd("quiz.start");
  await snap("round-intro-1", "Round 1 intro (jokers can still be played on it).", undefined, 1200);

  // --- rounds ------------------------------------------------------------------------------
  const allPlans = { ...BROWSER_TEAMS, ...PROTOCOL_TEAMS };
  const answerPhone = async (p: { name: string; c: Client }, q: Question, v: string | number) => {
    if (q.answer.type === "choice") {
      await p.c.page.click(`.opts button:nth-child(${(v as number) + 1})`);
    } else {
      await p.c.page.fill(`#a-${q.id}`, String(v));
      await p.c.page.click(".ph-foot .btn.primary:visible");
    }
  };

  for (let r = 0; r < quiz.rounds.length; r++) {
    await night.cmd("round.start");
    if (r === 0) await snap("asking-get-ready", "Round started, first question not shown yet.", undefined, 600);
    const rqs = quiz.rounds[r]!.questions;
    for (const [i, q] of rqs.entries()) {
      await night.cmd("question.next");
      await disp.page.waitForFunction((t) => document.body.innerText.includes(t), q.text.slice(0, 30), { timeout: 10_000 });
      await snap(`r${r + 1}q${i + 1}-shown-${q.answer.type}`, `Round ${r + 1}, question ${i + 1} (${q.answer.type}${q.media ? ", picture" : ""}) shown, timer not started.`, undefined, 800);
      await night.cmd("timer.start");
      if (i === 0 && r === 0) await snap(`r${r + 1}q${i + 1}-timer-running`, "Timer running, nobody has answered.", undefined, 1500);
      // a draft on one phone before sending
      if (q.answer.type !== "choice") {
        await phones[3]!.c.page.fill(`#a-${q.id}`, String(answerFor(allPlans[phones[3]!.name]!, r, i, q)));
      }
      for (const p of phones.slice(0, 3)) await answerPhone(p, q, answerFor(allPlans[p.name]!, r, i, q));
      for (const p of proto) await ok(p.c, "answer.submit", { questionId: q.id, value: wire(q, answerFor(allPlans[p.name]!, r, i, q)) });
      await waitFor<HostView>(night.host, (v) => (v.round?.questions.find((x) => x.id === q.id)?.answered ?? -1) >= 7, "7 answers", 8000);
      await snap(`r${r + 1}q${i + 1}-answered-${q.answer.type}`, `Round ${r + 1}, question ${i + 1}: 7 of 8 answered. Phones: three sent, one with a typed answer not sent yet.`, undefined, 600);
      if (q.media && r === 0) {
        await phones[0]!.c.page.click(".qimg");
        await snap("phone-picture-zoom", "Phone: picture enlarged.", named(phones[0]!.name), 400);
        await phones[0]!.c.page.click(".zoom");
      }
      if (q.answer.type !== "choice") await phones[3]!.c.page.click(".ph-foot .btn.primary:visible");
      else await answerPhone(phones[3]!, q, answerFor(allPlans[phones[3]!.name]!, r, i, q));
      await waitFor<HostView>(night.host, (v) => (v.round?.questions.find((x) => x.id === q.id)?.answered ?? -1) >= 8, "8 answers", 8000);
      if (r === 1 && i === 4) {
        // last seconds of a 15 s timer
        await Bun.sleep(8_000);
        await snap("last-seconds", "Last seconds of the timer.", undefined, 0);
      }
      if (r === 1 && i === 1) {
        // the server goes away mid-question
        restarting = true;
        await night.p.kill();
        await snap("reconnecting", "The server is down: every client's reconnecting state.", undefined, 3500);
        await Promise.all(night.all.map((c) => c.closed.catch(() => 0)));
        night.restarts++;
        night.p = await startProcess({ dataDir, port: PORT, publicUrl: PUBLIC });
        night.host = await night.client("host", "host");
        night.display = await night.client("display", "display");
        for (const p of proto) {
          const tok = night.phones.find((x) => x.name === p.name)!.token;
          p.c = await night.client("team", p.name, tok);
          night.phones.find((x) => x.name === p.name)!.c = p.c;
        }
        night.phones = night.phones.filter((x) => proto.some((p) => p.name === x.name));
        for (const c of clients) await c.page.waitForFunction(() => !/Reconnecting|Can't reach|Offline/i.test(document.body.innerText), undefined, { timeout: 20_000 }).catch(() => problems.push(`${c.name}: still offline after restart`));
        restarting = false;
        await snap("reconnected", "Everyone back after the restart, answers kept.", undefined, 800);
      }
      if (r === 0 && i === 1) {
        // a phone loses its connection
        await phones[3]!.c.page.context().setOffline(true);
        await snap("phone-offline", "Phone: offline mid-question (answering paused).", named(phones[3]!.name), 3500);
        await phones[3]!.c.page.context().setOffline(false);
        await phones[3]!.c.page.waitForFunction(() => !/offline/i.test(document.querySelector(".sent")?.textContent ?? ""), undefined, { timeout: 15_000 }).catch(() => {});
      }
      await night.cmd("lock");
      if (i === 0 || (r === 0 && i === 2)) await snap(`r${r + 1}q${i + 1}-locked`, `Round ${r + 1}, question ${i + 1} locked.`, undefined, 1000);
    }
    await night.cmd("round.finish");
    await snap(`r${r + 1}-marking`, `Round ${r + 1} marking: answers that did not match exactly wait for the host.`, undefined, 800);
    const hv = night.hostView();
    for (const m of hv.marking!.questions) for (const g of m.groups.filter((x) => x.mark === "pending")) {
      const near = /mack|gump/i.test(String(g.key));
      await ok(night.host, "mark.group", { questionId: m.question.id, key: g.key, mark: near ? "correct" : "wrong" });
    }
    await snap(`r${r + 1}-marked`, `Round ${r + 1} marked, ready to reveal.`, isConsole, 600);
    await night.cmd("reveal.start");
    await snap(`r${r + 1}-reveal-start`, `Round ${r + 1} reveal starts: question 1 first, its answer fades in 1.2 s later.`, isDisplay, 600);
    await snap(`r${r + 1}-reveal-start-answer`, `Round ${r + 1} reveal: answer 1 shown.`, undefined, 2000);
    for (const [k] of rqs.entries()) {
      await night.cmd("reveal.next");
      if (k < 3) await snap(`r${r + 1}-reveal-q${k + 2}`, `Round ${r + 1} reveal, answer ${k + 2}.`, undefined, 2200);
    }
    await night.synced();
    if (night.hostView().phase !== "leaderboard") await night.cmd("leaderboard.show").catch(() => {});
    await snap(`r${r + 1}-leaderboard`, `Leaderboard after round ${r + 1} (rows arrive bottom-up; taken after they settle).`, undefined, 9000);
    if (r === 0) {
      await night.cmd("round.next");
      await snap("halftime", "Halftime.", undefined, 1200);
      await night.cmd("round.next");
      await snap("round-intro-2", "Round 2 intro.", undefined, 1200);
    }
  }

  // --- sudden death --------------------------------------------------------------------------
  if (night.hostView().suddenDeathNeeded) {
    await night.cmd("sd.start");
    await snap("deadlock-intro", "Sudden death (\"Deadlock\") intro.", undefined, 1500);
    await night.cmd("sd.ask");
    await snap("deadlock-question", "Deadlock question. Phones: the two tied teams answer, the others watch.", undefined, 1200);
    const inIt = phones.filter((p) => night.hostView().suddenDeath!.teams.some((t) => t.name === p.name));
    for (const [k, p] of inIt.entries()) {
      await p.c.page.fill(`#a-${SD.id}`, String(k === 0 ? 324 : 300));
      await p.c.page.click(".ph-foot .btn.primary:visible");
    }
    await waitFor<HostView>(night.host, (v) => v.suddenDeath!.question!.answered === inIt.length, "sd answers", 5000);
    await snap("deadlock-answered", "Deadlock: both tied teams have answered.", undefined, 800);
    await night.cmd("lock");
    await snap("deadlock-locked", "Deadlock: locked.", undefined, 1000);
    await night.cmd("sd.reveal");
    await snap("deadlock-result", "Deadlock result.", undefined, 2000);
  }
  await night.cmd("quiz.end");
  await snap("winner", "Quiz end: the winner. Phones: winner vs. other places.", undefined, 2500);
  await night.cmd("final.show");
  await snap("final-standings", "Final standings with prizes.", undefined, 6000);

  // --- after the night ---------------------------------------------------------------------
  const late = await (await newContext(browser, "phone")).newPage();
  const lateC = { name: "late-phone", folder: "phone", page: late, full: true };
  watch(lateC);
  await late.goto(`${PUBLIC}${joinPath}`);
  await late.waitForFunction(() => /has started/i.test(document.body.innerText), undefined, { timeout: 8000 }).catch(() => problems.push("late phone: no join-closed screen"));
  await snap("join-closed", "Phone: a new phone opening the QR link after the quiz started.", named("late-phone"), 800);

  for (const c of [con, tab]) await c.page.goto(`${PUBLIC}/host/history`);
  await con.page.waitForSelector("table", { timeout: 5000 }).catch(() => {});
  for (const c of [con, tab]) await c.page.locator('button:has-text("Standings")').first().click().catch(() => {});
  await snap("history-night", "Console: history with tonight's standings open.", isConsole, 800);

  await night.cmd("night.close");
  await snap("night-closed", "Night closed: display back to waiting, phones told the night is over.", undefined, 1500);
  await late.goto(`${PUBLIC}/`);
  await snap("no-night", "Phone: no quiz running.", named("late-phone"), 1000);

  // --- a round-lock night (phones answer from a question picker) -----------------------------
  if (MODE === "default") {
    for (const c of [con, tab]) await c.page.goto(`${PUBLIC}/host/run`);
    night.phones = [];
    const { roomCode: rc2 } = await night.cmd("night.open", { quizId: roundQuiz.id }) as { roomCode: string };
    const ph = phones[1]!;
    await ph.c.page.goto(`${PUBLIC}/j/${rc2}`);
    await ph.c.page.fill("#team-name", ph.name);
    await ph.c.page.fill("#room-code", rc2);
    await ph.c.page.click(".ph-foot .btn.primary:visible");
    await ph.c.page.waitForFunction((nm) => document.querySelector(".ph-top .team")?.textContent === nm, ph.name, { timeout: 5000 });
    await night.join(rc2, "Universally Challenged II");
    await night.cmd("quiz.start");
    await night.cmd("round.start");
    for (const _ of roundQuiz.rounds[0]!.questions) await night.cmd("question.next");
    await night.cmd("timer.start");
    const q1 = roundQuiz.rounds[0]!.questions[0]!;
    await ph.c.page.fill(`#a-${q1.id}`, "Paris");
    await ph.c.page.click(".ph-foot .btn.primary:visible");
    await ph.c.page.click(".qnav button:nth-child(2)");
    await snap("round-lock-asking", "Round-lock quiz: all questions open at once; the phone picks one from the 1..N row.", or(isConsole, isDisplay, named(ph.name)), 1200);
    await night.cmd("lock").catch(() => {});
  }

  await browser.close();
  await night.stop();
  rmSync(dataDir, { recursive: true, force: true });

  // --- index -----------------------------------------------------------------------------
  const lines = [
    `# Lock-In screenshots (${MODE} theme)`,
    "",
    `Captured ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by tests/e2e/design-shots.ts against a real server.`,
    "Display 1920x1080 (viewport). Console 1280x800 and tablet 768x1024 (full page). Phone 390x844 at 2x (full page).",
    "",
    "| Step | What it shows | Files |",
    "|---|---|---|",
    ...index.map((e) => `| ${e.step} | ${e.note} | ${e.files.map((f) => `[${f.split("/")[0]}](${f})`).join(" ")} |`),
    "",
    problems.length ? `## Page errors seen while capturing (${problems.length})\n\n${problems.map((p) => `- ${p}`).join("\n")}` : "No page errors or console errors while capturing.",
    "",
  ];
  writeFileSync(join(OUT, "INDEX.md"), lines.join("\n"));
  console.log(`${n} steps; problems: ${problems.length}`);
  if (problems.length) console.log(problems.join("\n"));
}

await main();
