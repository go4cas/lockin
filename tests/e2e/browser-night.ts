// B9: the real pages against the real engine (TECH-SPEC 13.3, 13.4, 14.1 "checked
// against the real engine in B9"). A real server process; the display, the host
// console's run page and four phones open in Chromium; the phones join and answer
// through their own UI. The host's commands go over a protocol client (the console
// page is open as a second host connection and must follow every change).
// Fails on any page error, console error or failed request; takes a screenshot of
// every screen at every step. A Playwright tool, not a bun test (like
// tests/display/stress.cjs), because it needs Chromium.
//
//   bun tests/e2e/browser-night.ts [outDir] [question|round]
//   LOCKIN_BIN=dist/lockin-linux-x64 bun tests/e2e/browser-night.ts

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type Question, type QuizFile } from "../../src/shared/formats.ts";
import type { HistoryDetail, HostView } from "../../src/shared/protocol.ts";
import { writeQuiz } from "../night/fakes.ts";
import { tempDataDir } from "../helpers/process.ts";
import { Night, ok, waitFor } from "./driver.ts";

const OUT = process.argv[2] ?? join(import.meta.dir, "../../dist/b9-browser");
const LOCK_MODE = (process.argv[3] ?? "question") as "question" | "round";
const PORT = 18000 + Math.floor(Math.random() * 2000);
const PUBLIC = `http://127.0.0.1:${PORT}`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const qs = (r: number): Question[] => [
  { id: `q-b${r}a00000`, text: `Which band recorded Rumours? (round ${r + 1})`, answer: { type: "text", accepted: ["Fleetwood Mac"] } },
  { id: `q-b${r}b00000`, text: "Capital of Norway?", answer: { type: "choice", options: ["Paris", "Rome", "Oslo", "Bern"], correct: 2 } },
  { id: `q-b${r}c00000`, text: "How many legs has a spider?", answer: { type: "number", value: 8 } },
  { id: `q-b${r}d00000`, text: "Year of the Moon landing?", answer: { type: "datetime", precision: "year", value: "1969", scoring: "exact" } },
];
const quiz: QuizFile = {
  format: QUIZ_FORMAT, id: "browser-night", title: "Browser night", updatedAt: "2026-11-24T10:00:00.000Z",
  settings: { ...DEFAULT_QUIZ_SETTINGS, lockMode: LOCK_MODE, timerSeconds: 30, joker: true, halftimeAfterRound: 1 },
  rounds: [0, 1].map((r) => ({ id: `r-b000000${r}`, title: ["Music", "Science"][r]!, questions: qs(r) })),
  suddenDeath: [{ id: "q-bsd00000", text: "Closest: height of Everest in metres?", answer: { type: "closest", value: 8849 } }],
};
// Two teams always right and level -> sudden death; one team half right; one wrong.
const ANSWERS: Record<string, (q: Question) => string | number> = {
  "Quizteama Aguilera": (q) => right(q),
  "Les Quizerables": (q) => right(q),
  "Universally Challenged": (q) => (q.id.endsWith("a00000") || q.id.endsWith("c00000") ? right(q) : wrong(q)),
  "Agatha Quiztie": (q) => wrong(q),
};
function right(q: Question): string | number {
  const a = q.answer;
  return a.type === "text" ? a.accepted[0]! : a.type === "choice" ? a.correct : a.type === "datetime" ? a.value : (a as { value: number }).value;
}
function wrong(q: Question): string | number {
  const a = q.answer;
  return a.type === "text" ? "Abba" : a.type === "choice" ? (a.correct + 1) % 4 : a.type === "datetime" ? "1970" : (a as { value: number }).value + 3;
}

const problems: string[] = [];
let restarting = false;   // while the server is down, the browser logs failed WebSocket connects; those are expected
let shot = 0;

async function main() {
  const dataDir = tempDataDir("lockin-browser-");
  writeQuiz(dataDir, quiz);
  const night = new Night(dataDir, { port: PORT, publicUrl: PUBLIC });
  await night.start();
  const browser = await chromium.launch();
  const pages: { name: string; page: Page }[] = [];
  const watch = (name: string, page: Page) => {
    page.on("pageerror", (e) => problems.push(`${name}: page error: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !(restarting && /WebSocket/i.test(m.text()))) problems.push(`${name}: console error: ${m.text()}`); });
    page.on("requestfailed", (r) => { if (!r.url().includes("/ws")) problems.push(`${name}: request failed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on("response", (r) => { if (r.status() >= 400) problems.push(`${name}: ${r.status()} ${r.url()}`); });
    pages.push({ name, page });
  };
  const snap = async (step: string) => {
    shot++;
    await Bun.sleep(400);   // let animations settle
    for (const { name, page } of pages) {
      await page.screenshot({ path: join(OUT, `${String(shot).padStart(2, "0")}-${step}-${name.replace(/\W+/g, "_")}.png`) });
    }
  };

  try {
    const display = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    watch("display", display);
    await display.goto(`${PUBLIC}/display`);
    // REVIEW finding 4: the TV shows a pairing code until the host types it on the console
    await display.waitForSelector(".pair-code", { timeout: 5000 });
    await display.waitForFunction(() => /^[0-9]{4}$/.test(document.querySelector(".pair-code")?.textContent?.trim() ?? ""), null, { timeout: 5000 });

    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const [cname, cvalue] = night.cookie.split("=");
    await hostCtx.addCookies([{ name: cname!, value: cvalue!, url: PUBLIC }]);
    const consolePage = await hostCtx.newPage();
    watch("console", consolePage);
    await consolePage.goto(`${PUBLIC}/host/run`);
    await consolePage.waitForSelector(".pair-input", { timeout: 5000 });
    const pairCode = (await display.textContent(".pair-code"))!.trim();
    await consolePage.fill(".pair-input", pairCode);
    await snap("pairing");
    await consolePage.click(".pair-card button[type=submit]");
    await consolePage.waitForFunction(() => document.body.innerText.includes("Paired. The display shows the quiz now."), null, { timeout: 5000 });
    await display.waitForFunction(() => !document.querySelector(".pair-code"), null, { timeout: 5000 });

    const { roomCode } = await night.cmd("night.open", { quizId: quiz.id }) as { roomCode: string };
    await display.waitForFunction((code) => document.body.innerText.includes(code), roomCode, { timeout: 5000 });

    // phones join through the join page from the QR link
    const phones: { name: string; page: Page }[] = [];
    for (const name of Object.keys(ANSWERS)) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      watch(name, page);
      await page.goto(`${PUBLIC}/j/${roomCode}`);
      await page.fill("#team-name", name);
      await page.click(".ph-foot .btn.primary");
      await page.waitForFunction((n) => document.querySelector(".ph-top .team")?.textContent === n, name, { timeout: 5000 });
      phones.push({ name, page });
    }
    await waitFor<HostView>(night.host, (v) => v.teams.length === 4 && v.teams.every((t) => t.connected), "4 teams");
    await snap("lobby");

    // a joker through the phone UI, on round 1
    const joker = phones[2]!.page;
    await joker.click(".joker-card .btn.joker");
    await joker.click(".joker-card .btn.joker").catch(() => {});   // confirm, if asked
    await waitFor<HostView>(night.host, (v) => v.teams.find((t) => t.name === phones[2]!.name)!.jokerRound === 0, "joker played", 5000);

    await night.cmd("quiz.start");
    await snap("round-intro");

    const answerOn = async (p: { name: string; page: Page }, q: Question) => {
      const v = ANSWERS[p.name]!(q);
      if (q.answer.type === "choice") {
        await p.page.click(`.opts button:nth-child(${(v as number) + 1})`);
      } else {
        await p.page.fill(`#a-${q.id}`, String(v));
        await p.page.press(`#a-${q.id}`, "Enter");
      }
    };
    const waitAnswered = async (qid: string, n: number) =>
      waitFor<HostView>(night.host, (v) => (v.round?.questions.find((x) => x.id === qid)?.answered ?? -1) >= n, `${n} answers on ${qid}`, 8000);

    for (let r = 0; r < quiz.rounds.length; r++) {
      await night.cmd("round.start");
      const rqs = quiz.rounds[r]!.questions;
      if (LOCK_MODE === "question") {
        for (const [i, q] of rqs.entries()) {
          await night.cmd("question.next");
          // the display and the console page follow (after the restart too, through their own reconnect)
          for (const pg of [display, consolePage]) {
            await pg.waitForFunction((t) => document.body.innerText.includes(t), q.text, { timeout: 15_000 })
              .catch(() => problems.push(`${pg === display ? "display" : "console"}: question "${q.text}" not shown`));
          }
          if (i === 0) await night.cmd("timer.start");
          await Promise.all(phones.map((p) => p.page.waitForSelector(q.answer.type === "choice" ? ".opts button" : `#a-${q.id}`, { timeout: 5000 })));
          await Promise.all(phones.map((p) => answerOn(p, q)));
          await waitAnswered(q.id, 4);
          if (i === 0) await snap(`r${r + 1}-asking`);
          if (r === 1 && i === 1) {
            // kill -9 mid-question; the pages must reconnect on their own and show the same answers
            restarting = true;
            const t0 = Date.now();
            await night.killAndRestart();
            await snap("server-restarted");
            for (const { name, page } of pages) {
              await page.waitForFunction(() => !/Reconnecting|Offline/.test(document.body.innerText), undefined, { timeout: 15_000 })
                .catch(() => problems.push(`${name}: still offline 15 s after the restart`));
            }
            await waitFor<HostView>(night.host, (v) => v.teams.every((t) => t.connected), "phones back", 15_000);
            for (const p of phones) {
              const held = await p.page.textContent(".sent").catch(() => "");
              if (!/Sent|quizmaster has/i.test(held ?? "")) problems.push(`${p.name}: after the restart the phone does not show its sent answer (${held})`);
            }
            console.log(`[browser ${LOCK_MODE}] every page back ${Date.now() - t0} ms after kill -9`);
            restarting = false;
            await snap("pages-reconnected");
          }
          await night.cmd("lock");
          if (i === 0) await snap(`r${r + 1}-locked`);
        }
      } else {
        for (const _ of rqs) await night.cmd("question.next");
        await night.cmd("timer.start");
        // the phone shows one question at a time with a 1..N picker (.qnav); answer each through it
        for (const [i, q] of rqs.entries()) {
          await Promise.all(phones.map(async (p) => {
            await p.page.click(`.qnav button:nth-child(${i + 1})`);
            await p.page.waitForSelector(q.answer.type === "choice" ? ".opts button" : `#a-${q.id}`, { timeout: 5000 });
            await answerOn(p, q);
          }));
          await waitAnswered(q.id, 4);
        }
        await snap(`r${r + 1}-asking-round`);
        await night.cmd("lock");
      }
      await night.cmd("round.finish");
      const hv = night.hostView();
      for (const m of hv.marking!.questions) for (const g of m.groups.filter((x) => x.mark === "pending")) {
        await ok(night.host, "mark.group", { questionId: m.question.id, key: g.key, mark: "wrong" });
      }
      await snap(`r${r + 1}-marking`);
      await night.cmd("reveal.start");
      await snap(`r${r + 1}-reveal`);
      for (const _ of rqs) await night.cmd("reveal.next");
      await snap(`r${r + 1}-leaderboard`);
      if (r === 0) {
        await night.cmd("round.next");
        await snap("halftime");
        await night.cmd("round.next");
      }
    }

    if (night.hostView().suddenDeathNeeded) {
      await night.cmd("sd.start");
      await night.cmd("sd.ask");
      const sdq = quiz.suddenDeath[0]!;
      const inIt = phones.filter((p) => night.hostView().suddenDeath!.teams.some((t) => t.name === p.name));
      for (const [k, p] of inIt.entries()) {
        await p.page.waitForSelector(`#a-${sdq.id}`, { timeout: 5000 });
        await p.page.fill(`#a-${sdq.id}`, String(k === 0 ? 8800 : 9500));
        await p.page.press(`#a-${sdq.id}`, "Enter");
      }
      await waitFor<HostView>(night.host, (v) => v.suddenDeath!.question!.answered === inIt.length, "sd answers", 5000);
      await snap("sudden-death");
      await night.cmd("lock");
      await night.cmd("sd.reveal");
      await snap("sudden-death-reveal");
    }
    await night.cmd("quiz.end");
    await snap("winner");
    await night.cmd("final.show");
    await snap("final-standings");

    // the history page in the console
    const h = (await (await night.p.fetch(`/api/history/${night.hostView().night!.id}`, { cookie: night.cookie })).json()) as HistoryDetail;
    const expected = quiz.rounds.length * 4 * phones.length;
    const stored = h.answers.filter((a) => !a.questionId.startsWith("q-bsd")).length;
    if (stored !== expected) problems.push(`answers stored: ${stored}, expected ${expected} (every phone answered every question through its UI)`);
    await consolePage.goto(`${PUBLIC}/host/history`);
    await snap("history");
    console.log(`[browser ${LOCK_MODE}] ${night.p.target}: ${shot} steps, ${stored}/${expected} UI answers stored; standings ${h.standings.map((s) => `${s.position}. ${s.name} ${s.total}`).join(", ")}`);
    await night.cmd("night.close");
    await snap("closed");
  } catch (e) {
    problems.push(`script: ${e instanceof Error ? e.stack : String(e)}`);
    await snap("failure").catch(() => {});
  } finally {
    await browser.close();
    await night.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`screenshots in ${OUT}`);
  if (problems.length) {
    console.log(`PROBLEMS (${problems.length}):\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log("no page errors, console errors or failed requests");
}

await main();
