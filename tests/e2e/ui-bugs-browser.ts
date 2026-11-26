// Real-device UI bugs (docs/UI-BUGS.md), each checked in a real browser against the real server
// process. A Playwright check, not a bun test; part of tools/browser/checks.ts.
//
//   bun tests/e2e/ui-bugs-browser.ts [outDir]
//
// UI-01: Run night, Open a night: a quiz that is not ready shows its problem text, never
//        "[object Object]", and "1 round", not "1 rounds".
// UI-16: leaving a page with unsaved changes through a link asks in the design system's dialog.
// UI-18: Branding, going from Holding page to Prizes shows the Prizes tab (it was blank).
// UI-20: Holding page, a panel that is switched off stays in the list (it disappeared).
// UI-23: Holding page, how long each panel shows is a venue setting (it was a fixed 12 s).
// UI-22: Holding page, a Poster panel shows the venue's uploaded picture.
// UI-24: Run night on a phone (390 px): nothing is cut off and the Night menu is in reach.
// UI-25: Venue settings, the prizes tab says "Default prizes".
// UI-26: Venue settings, a Displays tab lists the paired TVs and can pair or unpair them.
// UI-27: the quiz builder uses Venue settings' page head (title, tabs) and settings cards.
// UI-02: a phone that has joined does not show the lobby pool ("Name your team...") on its
//        lobby screen; that pool is for the join page and the display (copy-review.md).

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "../../tools/browser/playwright.mjs";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type QuizFile } from "../../src/shared/formats.ts";
import { writeQuiz } from "../night/fakes.ts";
import { tempDataDir } from "../helpers/process.ts";
import { Night, ok } from "./driver.ts";

const OUT = process.argv[2] ?? join(import.meta.dir, "../../dist/ui-bugs-browser");
const PORT = 20000 + Math.floor(Math.random() * 2000);
const PUBLIC = `http://127.0.0.1:${PORT}`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// One round, two questions, the second with no answer yet: not ready.
const notReady = {
  format: QUIZ_FORMAT, id: "not-ready", title: "Test Quiz", updatedAt: "2026-11-24T10:00:00.000Z",
  settings: { ...DEFAULT_QUIZ_SETTINGS },
  rounds: [{ id: "r-ui000000", title: "Round 1", questions: [
    { id: "q-ui100000", text: "Who made Rumours?", answer: { type: "text", accepted: ["Fleetwood Mac"] } },
    { id: "q-ui200000", text: "Who made Abbey Road?", answer: { type: "text", accepted: [""] } },
  ] }],
  suddenDeath: [],
} as unknown as QuizFile;

const ready: QuizFile = {
  format: QUIZ_FORMAT, id: "ready", title: "Ready Quiz", updatedAt: "2026-11-24T10:00:00.000Z",
  settings: { ...DEFAULT_QUIZ_SETTINGS, timerSeconds: 60 },
  rounds: [{ id: "r-ui100000", title: "Round 1", questions: [
    { id: "q-ui300000", text: "What is the capital of England?", answer: { type: "text", accepted: ["London"] } },
    { id: "q-ui400000", text: "What is the capital of France?", answer: { type: "text", accepted: ["Paris"] } },
  ] }],
  suddenDeath: [],
};

const problems: string[] = [];
const results: string[] = [];
const check = (ok: boolean, what: string) => { results.push(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) problems.push(what); };

async function main() {
  const dataDir = tempDataDir("lockin-ui-bugs-");
  writeQuiz(dataDir, notReady);
  writeQuiz(dataDir, ready);
  const night = new Night(dataDir, { port: PORT, publicUrl: PUBLIC });
  await night.start();
  const browser = await chromium.launch();
  const watch = (name: string, page: Page) => {
    page.on("pageerror", (e) => problems.push(`${name}: page error: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/WebSocket/.test(m.text())) problems.push(`${name}: console error: ${m.text()}`); });
  };
  try {
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const [cname, cvalue] = night.cookie.split("=");
    await hostCtx.addCookies([{ name: cname!, value: cvalue!, url: PUBLIC }]);
    const host = await hostCtx.newPage();
    watch("console", host);

    // UI-01
    await host.goto(`${PUBLIC}/host/run`);
    await host.waitForFunction(() => !!document.querySelector(".quiz-pick .q-title")?.textContent, null, { timeout: 5000 });
    const row = await host.evaluate(() => {
      const li = document.querySelector(".quiz-pick li:not([hidden])")!;
      return { counts: li.querySelector(".muted.s")?.textContent ?? "", problems: li.querySelector(".problems")?.textContent ?? "" };
    });
    await host.screenshot({ path: join(OUT, "ui-01-open-night.png") });
    check(!row.problems.includes("[object Object]") && row.problems.trim().length > 0, `UI-01 not-ready reason is text: "${row.problems}"`);
    check(row.counts === "1 round · 2 questions", `UI-01 counts read "${row.counts}"`);

    // a paired display (the TV)
    const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    watch("display", tv);
    await tv.goto(`${PUBLIC}/display`);
    await tv.waitForFunction(() => /^[0-9]{6}$/.test(document.querySelector(".pair-code")?.textContent?.trim() ?? ""), null, { timeout: 5000 });
    await host.fill(".pair-input", (await tv.textContent(".pair-code"))!.trim());
    await host.click(".pair-card button[type=submit]");
    await tv.waitForFunction(() => !document.querySelector(".pair-code"), null, { timeout: 5000 });
    const footer = () => tv.evaluate(() => document.querySelector(".display-voice")?.textContent ?? "");

    // UI-02
    const { roomCode } = await night.cmd("night.open", { quizId: ready.id }) as { roomCode: string };
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    watch("phone", phone);
    await phone.goto(`${PUBLIC}${new URL(night.hostView().night!.joinUrl).pathname}`);
    const joinLine = await phone.waitForSelector(".voice", { timeout: 5000 }).then(() => true, () => false);
    check(joinLine, `UI-02 the join page shows a lobby line (room ${roomCode})`);
    await phone.fill("#team-name", "Test Team");
    await phone.click(".ph-foot .btn.primary");
    await phone.waitForFunction(() => document.querySelector(".ph-top .team")?.textContent === "Test Team", null, { timeout: 5000 });
    await phone.waitForTimeout(300);
    await phone.screenshot({ path: join(OUT, "ui-02-phone-lobby.png") });
    const lobbyLine = await phone.evaluate(() => [...document.querySelectorAll<HTMLElement>(".voice")].filter((e) => e.offsetParent !== null).map((e) => e.textContent).join(" | "));
    check(lobbyLine === "", `UI-02 the joined phone's lobby shows no join line: "${lobbyLine}"`);

    // UI-08: the team_joined line leaves the display's footer after FLASH_MS (6 s), lobby and holding page
    const joinedNow = await footer();
    await night.cmd("night.update", { plannedStart: Date.now() + 20 * 60_000 });
    await tv.waitForTimeout(7500);
    const joinedLater = await footer();
    await tv.screenshot({ path: join(OUT, "ui-08-holding-footer.png") });
    check(/Test Team/.test(joinedNow), `UI-08 the display says the team joined: "${joinedNow}"`);
    check(!/Test Team/.test(joinedLater), `UI-08 7.5 s later the join line has gone: "${joinedLater}"`);

    // UI-13: reveal tally dots match "N of M teams got it", also on the second reveal
    const t2 = await night.join(roomCode, "Second");
    const t3 = await night.join(roomCode, "Third");
    await night.cmd("night.update", { plannedStart: null });
    await night.cmd("quiz.start");
    await night.cmd("round.start");
    const answerAll = async (qid: string, right: string, rightTeams: number) => {
      await night.cmd("question.next");
      await phone.waitForSelector("input.input:not(#team-name)", { timeout: 5000 }).catch(() => {});
      for (const [i, t] of [t2, t3].entries()) {
        await ok(t.c, "answer.submit", { questionId: qid, value: { type: "text", text: i < rightTeams ? right : "Nope" } });
      }
      await night.cmd("lock");
    };
    await answerAll("q-ui300000", "London", 2);
    await answerAll("q-ui400000", "Paris", 1);
    await night.cmd("round.finish");
    await Bun.sleep(300);
    for (const m of night.hostView().marking!.questions) for (const g of m.groups.filter((x) => x.mark === "pending")) {
      await ok(night.host, "mark.group", { questionId: m.question.id, key: g.key, mark: "wrong" });
    }
    const dots = () => tv.evaluate(() => {
      const tally = document.querySelector(".tally");
      return { filled: tally?.querySelectorAll("i.ok").length ?? -1, text: tally?.textContent?.trim() ?? "" };
    });
    await night.cmd("reveal.start");
    await tv.waitForTimeout(1800);
    const first = await dots();
    await night.cmd("reveal.next");
    await tv.waitForTimeout(1800);
    const second = await dots();
    await tv.screenshot({ path: join(OUT, "ui-13-reveal-q2.png") });
    check(first.filled === 2 && /2 of 3/.test(first.text), `UI-13 first reveal: ${first.filled} dots, "${first.text}"`);
    check(second.filled === 1 && /1 of 3/.test(second.text), `UI-13 second reveal: ${second.filled} dots, "${second.text}"`);

    // UI-24: Run night on a phone, mid-reveal
    const phoneHostCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await phoneHostCtx.addCookies([{ name: cname!, value: cvalue!, url: PUBLIC }]);
    const phoneHost = await phoneHostCtx.newPage();
    watch("console-phone", phoneHost);
    await phoneHost.goto(`${PUBLIC}/host/run`);
    await phoneHost.waitForSelector(".menu-btn", { timeout: 5000 });
    await phoneHost.waitForTimeout(300);
    await phoneHost.screenshot({ path: join(OUT, "ui-23-run-phone.png"), fullPage: true });
    const fit = await phoneHost.evaluate(() => {
      const r = document.querySelector(".menu-btn")!.getBoundingClientRect();
      return { pageWidth: document.documentElement.scrollWidth, menuRight: Math.round(r.right) };
    });
    check(fit.pageWidth <= 390 && fit.menuRight <= 390, `UI-24 the phone page is ${fit.pageWidth} px wide, the Night menu ends at ${fit.menuRight} px`);
    await phoneHostCtx.close();

    // UI-18: tabs on the Branding page
    const brand = await hostCtx.newPage();
    watch("branding", brand);
    await brand.goto(`${PUBLIC}/host/brand`);
    await brand.waitForSelector("#venue-name", { timeout: 5000 });
    const shown = () => brand.evaluate(() => [...document.querySelectorAll<HTMLElement>(".tabs > div")].map((d) => (d.hidden ? "" : d.innerText.toLowerCase())).join("|"));
    for (const t of ["Holding page", "Prizes", "Branding", "Prizes"]) await brand.click(`[role=tab]:has-text("${t}")`);
    check(/default prizes/.test(await shown()), "UI-18 Prizes shows after Holding page and Branding");

    // UI-20
    await brand.click('[role=tab]:has-text("Holding page")');
    const rows = () => brand.evaluate(() => [...document.querySelectorAll<HTMLElement>(".panel-row")].filter((r) => r.offsetParent !== null).length);
    const before = await rows();
    await brand.click(".panel-row input.switch >> nth=0");
    const after = await rows();
    check(before === 6 && after === 6, `UI-20 switching a panel off keeps its row (${before} rows, then ${after})`);
    await brand.click(".panel-row input.switch >> nth=0");

    // UI-23, UI-22: panel seconds and a poster, saved
    await brand.fill("#panel-seconds", "20");
    await brand.setInputFiles("#poster-file", join(import.meta.dir, "pub-picture.jpg"));
    await brand.waitForSelector("img.poster-thumb", { timeout: 5000 });
    await brand.click('.tabs > div:not([hidden]) button[type=submit]');
    await brand.waitForFunction(() => /Saved/.test(document.body.innerText), null, { timeout: 5000 });
    const saved = await (await fetch(`${PUBLIC}/api/venue`, { headers: { cookie: night.cookie } })).json() as { holding: { panelSeconds: number; poster: string | null } };
    check(saved.holding.panelSeconds === 20, `UI-23 panel seconds saved: ${saved.holding.panelSeconds}`);
    const posterRes = saved.holding.poster ? await fetch(`${PUBLIC}/theme/${saved.holding.poster}`) : null;
    check(!!posterRes && posterRes.ok && /image\/jpeg/.test(posterRes.headers.get("content-type") ?? ""), `UI-22 poster saved and served: ${saved.holding.poster}`);
    await brand.screenshot({ path: join(OUT, "ui-21-22-holding-tab.png"), fullPage: true });

    // UI-25, UI-26
    const tabs = await brand.evaluate(() => [...document.querySelectorAll("[role=tab]")].map((t) => t.textContent?.trim()));
    check(tabs.includes("Default prizes") && tabs.includes("Displays"), `UI-25/26 tabs: ${tabs.join(", ")}`);
    await brand.click('[role=tab]:has-text("Displays")');
    const listed = await brand.waitForFunction(() => [...document.querySelectorAll<HTMLElement>(".paired-list li")].some((li) => !li.hidden && /Display 1/.test(li.textContent ?? "")), null, { timeout: 5000 }).then(() => true, () => false);
    await brand.screenshot({ path: join(OUT, "ui-26-displays-tab.png"), fullPage: true });
    check(listed, "UI-26 the Displays tab lists the paired TV");

    // UI-27: builder tabs and settings cards
    const build = await hostCtx.newPage();
    watch("builder", build);
    await build.goto(`${PUBLIC}/host/build?quiz=${ready.id}`);
    await build.waitForSelector("#round-title", { timeout: 5000 });
    const buildTabs = await build.evaluate(() => [...document.querySelectorAll(".b-head [role=tab]")].map((t) => t.textContent?.trim()).join(", "));
    await build.click('[role=tab]:has-text("Settings")');
    await build.waitForSelector("#quiz-title", { timeout: 5000 });
    const settings = await build.evaluate(() => ({
      cards: document.querySelectorAll(".b-settings .form-card").length,
      side: (document.querySelector(".b-side") as HTMLElement | null)?.offsetParent !== null,
    }));
    await build.screenshot({ path: join(OUT, "ui-27-builder-settings.png"), fullPage: true });
    check(buildTabs === "Rounds, Sudden death, Settings" && settings.cards === 4 && !settings.side, `UI-27 builder tabs "${buildTabs}", ${settings.cards} settings cards, outline shown: ${settings.side}`);
    await build.close();

    // UI-16: unsaved changes, then a nav link
    await brand.click('[role=tab]:has-text("Branding")');
    await brand.fill("#venue-name", "The Unsaved Arms");
    await brand.click('#host-nav a[href="/host/build"]');
    const asked = await brand.waitForSelector("dialog.leave-dlg[open]", { timeout: 3000 }).then(() => true, () => false);
    await brand.screenshot({ path: join(OUT, "ui-16-leave-dialog.png") });
    check(asked, "UI-16 leaving with unsaved changes opens the Leave dialog");
    await brand.click('dialog.leave-dlg button:has-text("Stay")');
    check(new URL(brand.url()).pathname === "/host/brand" && (await brand.inputValue("#venue-name")) === "The Unsaved Arms", "UI-16 Stay keeps the page and the typing");
    await brand.click('#host-nav a[href="/host/build"]');
    await brand.click('dialog.leave-dlg button:has-text("Leave")');
    await brand.waitForURL(/\/host\/build/, { timeout: 5000 });
    check(true, "UI-16 Leave goes to the link");
  } finally {
    await browser.close();
    await night.stop();
  }
}

await main().catch((e) => { problems.push(`crashed: ${e?.stack ?? e}`); });
for (const r of results) console.log(r);
if (problems.length) { console.log("\nProblems:"); for (const p of problems) console.log(`  ${p}`); process.exit(1); }
console.log("UI bug checks passed.");
