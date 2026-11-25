// Real-device UI bugs (docs/UI-BUGS.md), each checked in a real browser against the real server
// process. A Playwright check, not a bun test; part of tools/browser/checks.ts.
//
//   bun tests/e2e/ui-bugs-browser.ts [outDir]
//
// UI-01: Run night, Open a night: a quiz that is not ready shows its problem text, never
//        "[object Object]", and "1 round", not "1 rounds".
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
  } finally {
    await browser.close();
    await night.stop();
  }
}

await main().catch((e) => { problems.push(`crashed: ${e?.stack ?? e}`); });
for (const r of results) console.log(r);
if (problems.length) { console.log("\nProblems:"); for (const p of problems) console.log(`  ${p}`); process.exit(1); }
console.log("UI bug checks passed.");
