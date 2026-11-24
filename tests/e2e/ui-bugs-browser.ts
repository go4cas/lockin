// Real-device UI bugs (docs/UI-BUGS.md), each checked in a real browser against the real server
// process. A Playwright check, not a bun test; part of tools/browser/checks.ts.
//
//   bun tests/e2e/ui-bugs-browser.ts [outDir]
//
// UI-01: Run night, Open a night: a quiz that is not ready shows its problem text, never
//        "[object Object]", and "1 round", not "1 rounds".

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "../../tools/browser/playwright.mjs";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type QuizFile } from "../../src/shared/formats.ts";
import { writeQuiz } from "../night/fakes.ts";
import { tempDataDir } from "../helpers/process.ts";
import { Night } from "./driver.ts";

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

const problems: string[] = [];
const results: string[] = [];
const check = (ok: boolean, what: string) => { results.push(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) problems.push(what); };

async function main() {
  const dataDir = tempDataDir("lockin-ui-bugs-");
  writeQuiz(dataDir, notReady);
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
  } finally {
    await browser.close();
    await night.stop();
  }
}

await main().catch((e) => { problems.push(`crashed: ${e?.stack ?? e}`); });
for (const r of results) console.log(r);
if (problems.length) { console.log("\nProblems:"); for (const p of problems) console.log(`  ${p}`); process.exit(1); }
console.log("UI bug checks passed.");
