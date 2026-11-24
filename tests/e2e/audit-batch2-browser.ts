// Audit Batch 2 in a real browser (SA-11, D5, per-display unpair). A Playwright tool, not a
// bun test, like browser-night.ts. Fails on any page error or failed request.
//
//   bun tests/e2e/audit-batch2-browser.ts [outDir]
//
// 1. A TV paired by code: its join QR is fetched with the token in a header; no request URL
//    from the display page carries the token (SA-11).
// 2. "Open display" from the signed-in console: paired by the session, no token stored (D5).
// 3. The console lists the paired TV; "Unpair" on it sends it back to a code (SA-11).
// 4. Signing out of the console unpairs the session's display (D5).

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type QuizFile } from "../../src/shared/formats.ts";
import { writeQuiz } from "../night/fakes.ts";
import { tempDataDir } from "../helpers/process.ts";
import { Night } from "./driver.ts";

const OUT = process.argv[2] ?? join(import.meta.dir, "../../dist/audit-batch2-browser");
const PORT = 20000 + Math.floor(Math.random() * 2000);
const PUBLIC = `http://127.0.0.1:${PORT}`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const quiz: QuizFile = {
  format: QUIZ_FORMAT, id: "batch2", title: "Batch 2", updatedAt: "2026-11-24T10:00:00.000Z",
  settings: { ...DEFAULT_QUIZ_SETTINGS, timerSeconds: 30 },
  rounds: [{ id: "r-b2000000", title: "Music", questions: [{ id: "q-b2a00000", text: "Who made Rumours?", answer: { type: "text", accepted: ["Fleetwood Mac"] } }] }],
  suddenDeath: [],
};

const problems: string[] = [];
const results: string[] = [];
const check = (ok: boolean, what: string) => { results.push(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) problems.push(what); };

async function main() {
  const dataDir = tempDataDir("lockin-batch2-");
  writeQuiz(dataDir, quiz);
  const night = new Night(dataDir, { port: PORT, publicUrl: PUBLIC });
  await night.start();
  const browser = await chromium.launch();
  const watch = (name: string, page: Page, urls?: string[]) => {
    page.on("pageerror", (e) => problems.push(`${name}: page error: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|401/.test(m.text())) problems.push(`${name}: console error: ${m.text()}`); });
    page.on("request", (r) => urls?.push(r.url()));
    page.on("requestfailed", (r) => { if (!r.url().includes("/ws")) problems.push(`${name}: request failed: ${r.url()} ${r.failure()?.errorText}`); });
  };
  const qrIsData = (page: Page) => page.waitForFunction(() => {
    const img = document.querySelector(".qr img") as HTMLImageElement | null;
    return !!img && !img.hidden && img.src.startsWith("data:image/svg+xml") && img.naturalWidth > 0;
  }, null, { timeout: 5000 });

  try {
    const { roomCode } = await night.cmd("night.open", { quizId: quiz.id }) as { roomCode: string };

    // 1. The pub's TV, paired by code
    const tvUrls: string[] = [];
    const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    watch("tv", tv, tvUrls);
    await tv.goto(`${PUBLIC}/display`);
    await tv.waitForFunction(() => /^[0-9]{6}$/.test(document.querySelector(".pair-code")?.textContent?.trim() ?? ""), null, { timeout: 5000 });

    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const [cname, cvalue] = night.cookie.split("=");
    await hostCtx.addCookies([{ name: cname!, value: cvalue!, url: PUBLIC }]);
    const consolePage = await hostCtx.newPage();
    watch("console", consolePage);
    await consolePage.goto(`${PUBLIC}/host/run`);
    await consolePage.waitForSelector(".pair-input", { timeout: 5000 });
    await consolePage.fill(".pair-input", (await tv.textContent(".pair-code"))!.trim());
    await consolePage.click(".pair-card button[type=submit]");
    await tv.waitForFunction((code) => document.body.innerText.includes(code), roomCode, { timeout: 5000 });
    await qrIsData(tv);
    const token = await tv.evaluate(() => localStorage.getItem("lockin.display") ?? "");
    check(token.length > 20, "the TV keeps a pairing token");
    check(tvUrls.length > 0 && tvUrls.every((u) => !u.includes(token) && !u.includes(encodeURIComponent(token))), `no request URL from the TV page carries the token (${tvUrls.length} requests)`);
    check(!tvUrls.some((u) => u.includes("/qr/join.svg?")), "the QR is fetched without a query string");
    await tv.screenshot({ path: join(OUT, "01-tv-paired-qr.png") });

    // 2. D5: "Open display" from the signed-in console
    const sessionDisplay = await hostCtx.newPage();
    watch("console-display", sessionDisplay);
    await sessionDisplay.setViewportSize({ width: 1280, height: 720 });
    await sessionDisplay.goto(`${PUBLIC}/display`);
    await sessionDisplay.waitForFunction((code) => document.body.innerText.includes(code), roomCode, { timeout: 5000 });
    await qrIsData(sessionDisplay);
    check((await sessionDisplay.evaluate(() => localStorage.getItem("lockin.display"))) === null, "D5: the console-opened display stores no token");
    await sessionDisplay.screenshot({ path: join(OUT, "02-console-display-by-session.png") });

    // 3. The console lists the TV; unpair it alone
    await consolePage.waitForFunction(() => /Display 1 · connected now from 127\.0\.0\.1 · paired just now/.test(document.body.innerText), null, { timeout: 5000 });
    await consolePage.waitForFunction(() => /opened from a signed-in console/.test(document.body.innerText), null, { timeout: 5000 });
    check(true, "the console lists Display 1 with its address, and the session display");
    await consolePage.locator(".pair-card").screenshot({ path: join(OUT, "03-console-paired-list.png") });
    await consolePage.click(".paired-list button.link");
    await consolePage.click(".paired-list button.btn.danger");
    await tv.waitForFunction(() => /^[0-9]{6}$/.test(document.querySelector(".pair-code")?.textContent?.trim() ?? ""), null, { timeout: 5000 });
    check(!(await tv.evaluate((code) => document.body.innerText.includes(code), roomCode)), "after Unpair the TV shows a code and no room code");
    check(await sessionDisplay.evaluate((code) => document.body.innerText.includes(code), roomCode), "the session display stays paired");
    await consolePage.waitForFunction(() => /Display 1 is unpaired/.test(document.body.innerText), null, { timeout: 5000 });
    await consolePage.locator(".pair-card").screenshot({ path: join(OUT, "04-console-after-unpair-one.png") });
    await tv.screenshot({ path: join(OUT, "05-tv-unpaired.png") });

    // 4. D5: signing out unpairs the console-opened display
    const out = await consolePage.evaluate(async () => (await fetch("/api/auth/logout", { method: "POST" })).status);
    check(out === 200, "sign out");
    await sessionDisplay.waitForFunction(() => /^[0-9]{6}$/.test(document.querySelector(".pair-code")?.textContent?.trim() ?? ""), null, { timeout: 5000 });
    check(!(await sessionDisplay.evaluate((code) => document.body.innerText.includes(code), roomCode)), "D5: after sign-out the console-opened display shows a code");
    await sessionDisplay.screenshot({ path: join(OUT, "06-console-display-after-signout.png") });
  } catch (e) {
    problems.push(`stopped: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await browser.close();
    await night.stop();
  }
  console.log(results.join("\n"));
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`\nAll checks passed. Screenshots in ${OUT}`);
}

await main();
