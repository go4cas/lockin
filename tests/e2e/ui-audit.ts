// UI consistency audit (batch 7): measures every console, phone and display screen's buttons, fields,
// headings, cards and text against the design system tokens and lists what differs. Not a check:
// it writes audit.json and screenshots for docs/UI-BUGS.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "../../tools/browser/playwright.mjs";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type QuizFile } from "../../src/shared/formats.ts";
import { writeQuiz } from "../night/fakes.ts";
import { tempDataDir } from "../helpers/process.ts";
import { Night } from "./driver.ts";

const OUT = process.argv[2] ?? join(import.meta.dir, "../../dist/ui-audit");
mkdirSync(OUT, { recursive: true });
const PORT = 22000 + Math.floor(Math.random() * 2000);
const PUBLIC = `http://127.0.0.1:${PORT}`;

const quiz: QuizFile = {
  format: QUIZ_FORMAT, id: "audit", title: "Audit Quiz", updatedAt: "2026-11-24T10:00:00.000Z",
  settings: { ...DEFAULT_QUIZ_SETTINGS },
  rounds: [{ id: "r-au000000", title: "Round 1", questions: [
    { id: "q-au100000", text: "Who made Rumours?", answer: { type: "text", accepted: ["Fleetwood Mac"] } },
    { id: "q-au200000", text: "Pick one", answer: { type: "choice", options: ["A", "B", "C"], correct: 0 } },
  ] }],
  suddenDeath: [],
} as unknown as QuizFile;

/** Reads what each kind of element looks like on the page. */
function measure() {
  const vis = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const css = (el: Element) => getComputedStyle(el);
  const pick = (sel: string, f: (el: Element, s: CSSStyleDeclaration) => string) => {
    const out: Record<string, string[]> = {};
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el)) continue;
      const k = f(el, css(el));
      const name = (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : el.tagName.toLowerCase()) + ` "${(el.textContent ?? "").trim().slice(0, 24)}"`;
      (out[k] ??= []).push(name);
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.slice(0, 6).concat(v.length > 6 ? [`+${v.length - 6} more`] : [])]));
  };
  const texts = new Map<string, number>();
  const colours = new Map<string, number>();
  const fonts = new Map<string, number>();
  for (const el of document.querySelectorAll("body *")) {
    if (!vis(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
    const s = css(el);
    texts.set(`${s.fontSize}/${s.fontWeight}`, (texts.get(`${s.fontSize}/${s.fontWeight}`) ?? 0) + 1);
    colours.set(s.color, (colours.get(s.color) ?? 0) + 1);
    fonts.set(s.fontFamily.split(",")[0]!, (fonts.get(s.fontFamily.split(",")[0]!) ?? 0) + 1);
  }
  return {
    buttons: pick("button, .btn, a.btn, label.btn, summary.pill", (el, s) => `h${Math.round(el.getBoundingClientRect().height)} r${s.borderRadius} ${s.fontSize}/${s.fontWeight} bg ${s.backgroundColor} ${s.boxShadow === "none" ? "" : "ring"}`),
    fields: pick("input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), select, textarea", (el, s) => `h${Math.round(el.getBoundingClientRect().height)} r${s.borderRadius} ${s.fontSize} bg ${s.backgroundColor} border ${s.borderTopWidth} ${s.boxShadow === "none" ? "" : "ring"}`),
    headings: pick("h1, h2, h3, .label, .overline, .eyebrow", (el, s) => `${el.tagName.toLowerCase()} ${s.fontSize}/${s.fontWeight} ${s.fontFamily.split(",")[0]} ${s.textTransform} ${s.color}`),
    cards: pick(".card, .form-card, dialog, .popover, .menu", (el, s) => `r${s.borderRadius} bg ${s.backgroundColor} pad ${s.paddingTop} ${s.paddingLeft}`),
    textSizes: Object.fromEntries([...texts].sort((a, b) => b[1] - a[1])),
    textColours: Object.fromEntries([...colours].sort((a, b) => b[1] - a[1])),
    fonts: Object.fromEntries(fonts),
    pageLeft: Math.round((document.querySelector("main, .host-main, .stage, .ph, .display-main") as HTMLElement | null)?.getBoundingClientRect().left ?? -1),
  };
}

async function main() {
  const dataDir = tempDataDir("lockin-ui-audit-");
  writeQuiz(dataDir, quiz);
  const night = new Night(dataDir, { port: PORT, publicUrl: PUBLIC });
  await night.start();
  const browser = await chromium.launch();
  const report: Record<string, unknown> = {};
  const errors: string[] = [];
  const shot = async (page: Page, name: string, setup?: () => Promise<void>) => {
    if (setup) await setup();
    await page.waitForTimeout(400);
    report[name] = await page.evaluate(measure);
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const [cname, cvalue] = night.cookie.split("=");
    await ctx.addCookies([{ name: cname!, value: cvalue!, url: PUBLIC }]);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`));
    const go = async (path: string, wait: string) => { await p.goto(PUBLIC + path); await p.waitForSelector(wait, { timeout: 8000 }); };

    await go("/host", ".home-hero"); await shot(p, "host-home");
    await go("/host/build", ".lib-tools"); await shot(p, "host-quizzes");
    await go("/host/build?quiz=audit", "#round-title"); await shot(p, "host-builder-round");
    await p.click(".q-list a:visible >> nth=0"); await p.waitForSelector("#q-text"); await shot(p, "host-builder-question");
    await p.click('[role=tab]:has-text("Settings")'); await p.waitForSelector("#quiz-title"); await shot(p, "host-builder-settings");
    await go("/host/brand", "#venue-name"); await shot(p, "host-venue-branding");
    for (const t of ["Holding page", "Default prizes", "Quiz defaults", "Displays"]) {
      await p.click(`[role=tab]:has-text("${t}")`);
      await shot(p, "host-venue-" + t.toLowerCase().replace(/ /g, "-"));
    }
    await go("/host/history", ".host-main h1"); await shot(p, "host-history");
    await go("/host/run", ".quiz-pick"); await shot(p, "host-run-idle");
    const { roomCode } = await night.cmd("night.open", { quizId: "audit" }) as { roomCode: string };
    await p.waitForSelector('button:has-text("Edit prizes")', { timeout: 8000 }); await shot(p, "host-run-lobby");
    const team = await night.join(roomCode, "Quiz Team");

    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const ph = await phoneCtx.newPage();
    ph.on("pageerror", (e) => errors.push(`phone: ${e.message}`));
    await ph.goto(`${PUBLIC}${new URL(night.hostView().night!.joinUrl).pathname}`);
    await ph.waitForSelector("#team-name"); await shot(ph, "phone-join");
    await ph.fill("#team-name", "Phone Team"); await ph.click(".ph-foot .btn.primary");
    await ph.waitForFunction(() => document.querySelector(".ph-top .team")?.textContent === "Phone Team");
    await shot(ph, "phone-lobby");

    const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    tv.on("pageerror", (e) => errors.push(`display: ${e.message}`));
    await tv.goto(`${PUBLIC}/display`); await tv.waitForSelector(".pair-code"); await shot(tv, "display-pair");
    await p.fill(".pair-card:visible .pair-input", (await tv.textContent(".pair-code"))!.trim());
    await p.click(".pair-card:visible button[type=submit]");
    await tv.waitForFunction(() => !document.querySelector(".pair-code"), null, { timeout: 8000 });
    await shot(tv, "display-lobby");

    await night.cmd("quiz.start");
    await p.waitForTimeout(500); await shot(p, "host-run-round-intro");
    await night.cmd("round.start");
    await night.cmd("question.next");
    await ph.waitForTimeout(800); await shot(ph, "phone-asking"); await shot(p, "host-run-asking"); await shot(tv, "display-asking");
    void team;

    const out = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const lp = await out.newPage();
    await lp.goto(`${PUBLIC}/host/login`); await lp.waitForSelector("input"); await shot(lp, "host-login");
  } catch (e) {
    errors.push(`crashed: ${(e as Error).stack ?? e}`);
  } finally {
    await browser.close();
    await night.stop();
  }
  writeFileSync(join(OUT, "audit.json"), JSON.stringify({ errors, report }, null, 1));
  console.log(`errors: ${errors.length ? errors.join("\n") : "none"}\nscreens: ${Object.keys(report).join(", ")}`);
}
await main();
