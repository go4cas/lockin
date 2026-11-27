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
// UI-28: the server's version shows after the credit on the host console, the display and the phone.
// UI-29: the builder's "Add a picture" button has its text in the middle.
// UI-30: the host console's header stays at the top when the page scrolls.
// UI-31: the builder's Settings tab lines its labels and controls up in two columns.
// UI-32: the host home page shows the Lock-In lockup and Cas's animated "Last orders" artwork.
// UI-33: Venue settings has Quiz defaults; a new quiz starts with them.
// UI-34: the Quizzes list has a title search and an All / Ready / Needs work filter.
// UI-35: the console shows a loader (the mark's ring turning) instead of "Loading…" text.
// UI-36: every console page lines up with the nav's left edge.
// UI-37: selects are styled like the other fields, not the browser's own.
// UI-38: console pages are a centred column (at most 1200 px, at least 48 px each side on a laptop).
// UI-39: page loaders are centred.
// UI-40: the open select list is styled where the browser allows it (customizable select).
// UI-41: the builder's delete buttons ask with the console's own dialog, not the browser's confirm().
// UI-42: Quiz Settings sits in two columns of cards on a laptop, so it needs little scrolling.
// UI-43: a quiz that isn't ready lists what needs fixing in a popover under the header's pill
//        (each line goes to the problem); the Settings tab no longer carries the whole list.
// UI-44: the home page's text and artwork sit together in the middle, without a wide gap.
// UI-45: deleting a question keeps the builder working (no Arrow error).
// UI-46: Quiz defaults' Halftime names Halfway's round and can be set to a round.
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
    page.on("pageerror", (e) => problems.push(`${name}: page error: ${e.message} (after ${results.length} checks)`));
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

    // UI-28: the version shows after the credit on the phone and the display
    const version = (await (await fetch(`${PUBLIC}/api/ping`)).json() as { version: string }).version;
    const shownOn = (p: Page, sel: string) => p.waitForFunction((s) => document.querySelector(s)?.textContent ?? "", sel, { timeout: 5000 }).then((h) => h.jsonValue(), () => "");
    const phoneVersion = await shownOn(phone, ".credit .app-version");
    const tvVersion = await shownOn(tv, ".display-credit .app-version");
    check(phoneVersion === `v${version}` && tvVersion === `v${version}`, `UI-28 phone shows "${phoneVersion}", display shows "${tvVersion}" (server ${version})`);
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

    // UI-31: every settings field puts its label in the same left column, as in Venue settings
    const columns = await build.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>(".b-settings .form-card .field")];
      const lefts = new Set(rows.map((r) => Math.round((r.querySelector(".l") as HTMLElement).getBoundingClientRect().left)));
      const controls = new Set(rows.map((r) => {
        const c = r.querySelector(".ctl") as HTMLElement | null;
        return c ? Math.round(c.getBoundingClientRect().left) : -1;
      }));
      return { rows: rows.length, lefts: [...lefts], controls: [...controls] };
    });
    // Two columns of cards on a laptop (UI-42): one label column and one control column per card column.
    check(columns.rows >= 8 && columns.lefts.length <= 2 && columns.controls.length === columns.lefts.length, `UI-31 settings: ${columns.rows} fields, label columns ${columns.lefts.join("/")}, control columns ${columns.controls.join("/")}`);

    // UI-29: "Add a picture" text sits in the middle of its button
    await build.click('[role=tab]:has-text("Rounds")');
    await build.click(".b-qs a.b-q >> nth=0");
    await build.waitForSelector(".file-btn", { timeout: 5000 });
    const off = await build.evaluate(() => {
      const label = document.querySelector(".file-btn") as HTMLElement;
      const text = [...label.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim()) as Text;
      const range = document.createRange();
      range.selectNodeContents(text);
      const t = range.getBoundingClientRect(), b = label.getBoundingClientRect();
      return Math.abs((t.top + t.bottom) / 2 - (b.top + b.bottom) / 2);
    });
    await build.locator(".file-btn").first().screenshot({ path: join(OUT, "ui-29-add-picture.png") });
    check(off <= 2, `UI-29 "Add a picture" text is ${off.toFixed(1)} px off the button's middle`);

    // UI-30: the host header stays at the top when the page scrolls
    await build.evaluate(() => window.scrollTo(0, 400));
    const navTop = await build.evaluate(() => Math.round(document.getElementById("host-nav")!.getBoundingClientRect().top));
    check(navTop === 0, `UI-30 host header top after scrolling: ${navTop}px`);

    // UI-28: the version shows after the credit (host here; display and phone below)
    const want = (await (await fetch(`${PUBLIC}/api/ping`)).json() as { version: string }).version;
    const hostVersion = await build.waitForFunction(() => document.querySelector(".host-credit .app-version")?.textContent ?? "", null, { timeout: 5000 }).then((h) => h.jsonValue(), () => "");
    check(hostVersion === `· v${want}`, `UI-28 host console shows "${hostVersion}" (server ${want})`);
    await build.close();

    // UI-41, UI-43: a quiz that isn't ready
    const fix = await hostCtx.newPage();
    watch("builder-not-ready", fix);
    let browserDialog = false;
    fix.on("dialog", (d) => { browserDialog = true; void d.dismiss(); });
    await fix.goto(`${PUBLIC}/host/build?quiz=${notReady.id}`);
    await fix.waitForSelector(".fix-pop summary", { timeout: 5000 });
    await fix.click(".fix-pop summary");
    const pop = await fix.evaluate(() => [...document.querySelectorAll(".fix-pop[open] li a")].map((a) => a.textContent?.trim()));
    await fix.screenshot({ path: join(OUT, "ui-43-what-needs-fixing.png") });
    await fix.click(".fix-pop li a >> nth=0");
    const went = await fix.waitForSelector("#q-text", { timeout: 5000 }).then(() => true, () => false);
    const closed = await fix.evaluate(() => !document.querySelector(".fix-pop[open]"));
    check(pop.length >= 1 && went && closed, `UI-43 "What needs fixing": ${pop.length} line(s) "${pop[0]}", goes to the question ${went}, closes ${closed}`);
    await fix.click('[role=tab]:has-text("Settings")');
    await fix.waitForSelector("#quiz-title", { timeout: 5000 });
    const settingsList = await fix.evaluate(() => document.querySelectorAll(".b-settings .problem-list, .b-settings li").length);
    await fix.click('.readiness button:has-text("See what needs fixing")');
    const reopened = await fix.evaluate(() => !!document.querySelector(".fix-pop[open]"));
    check(settingsList === 0 && reopened, `UI-43 Settings tab: ${settingsList} list lines, "See what needs fixing" opens the popover ${reopened}`);
    await fix.keyboard.press("Escape");
    await fix.evaluate(() => document.querySelector(".fix-pop")?.removeAttribute("open"));
    await fix.click('[role=tab]:has-text("Rounds")');
    await fix.click(".b-qs a.b-q >> nth=0");
    await fix.waitForSelector("#q-text", { timeout: 5000 });
    await fix.click('button.btn.danger:has-text("Delete")');
    const own = await fix.waitForSelector("dialog.dlg[open]", { timeout: 3000 }).then(() => true, () => false);
    await fix.screenshot({ path: join(OUT, "ui-41-delete-dialog.png") });
    const qsBefore = await fix.evaluate(() => document.querySelectorAll(".b-qs a.b-q:not(.add)").length);
    await fix.click('dialog.dlg[open] button:has-text("Keep it")');
    const kept = await fix.evaluate(() => document.querySelectorAll(".b-qs a.b-q:not(.add)").length);
    await fix.click('button.btn.danger:has-text("Delete")');
    await fix.click('dialog.dlg[open] button:has-text("Delete question")');
    await fix.waitForFunction((n) => document.querySelectorAll(".b-qs a.b-q:not(.add)").length === n - 1, qsBefore, { timeout: 5000 });
    check(own && !browserDialog && kept === qsBefore, `UI-41 delete asks in the console's dialog ${own}, browser dialog ${browserDialog}, "Keep it" keeps ${kept}/${qsBefore}, "Delete question" deletes`);
    await fix.close();

    // UI-42: Quiz Settings on a laptop: cards two by two, page about a screen and a half
    const set = await hostCtx.newPage();
    await set.setViewportSize({ width: 1440, height: 900 });
    await set.goto(`${PUBLIC}/host/build?quiz=${ready.id}`);
    await set.waitForSelector("#round-title", { timeout: 5000 });
    await set.click('[role=tab]:has-text("Settings")');
    await set.waitForSelector("#quiz-title", { timeout: 5000 });
    const lay = await set.evaluate(() => ({
      tops: new Set([...document.querySelectorAll<HTMLElement>(".b-settings .form-card")].map((c) => Math.round(c.getBoundingClientRect().top))).size,
      height: document.documentElement.scrollHeight,
    }));
    await set.screenshot({ path: join(OUT, "ui-42-quiz-settings.png"), fullPage: true });
    check(lay.tops <= 2 && lay.height <= 1500, `UI-42 Quiz Settings at 1440x900: cards in ${lay.tops} rows, page ${lay.height}px tall`);
    await set.close();

    // UI-32: the home page shows the lockup and the "Last orders" artwork, in the venue's colour,
    // still with reduced motion
    for (const motion of ["no-preference", "reduce"] as const) {
      const homeCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: motion });
      await homeCtx.addCookies([{ name: cname!, value: cvalue!, url: PUBLIC }]);
      const home = await homeCtx.newPage();
      watch("home", home);
      await home.goto(`${PUBLIC}/host`);
      const art = await home.evaluate(() => {
        const svg = document.querySelector(".home-art svg") as SVGSVGElement | null;
        return {
          shown: !!svg && svg.getBoundingClientRect().width > 300,
          lockup: document.querySelector(".home-copy .lockup")?.getAttribute("aria-label") ?? "",
          inlineStyles: document.querySelectorAll(".home-art [style]").length,
          venue: getComputedStyle(document.querySelector(".li-art")!).getPropertyValue("--li-venue").trim(),
          moving: getComputedStyle(document.querySelector(".li-liq")!).animationName !== "none",
        };
      });
      if (motion === "no-preference") await home.screenshot({ path: join(OUT, "ui-32-home.png") });
      if (motion === "no-preference") {
        const gap = await home.evaluate(() => {
          const copy = document.querySelector(".home-copy")!.getBoundingClientRect(), artBox = document.querySelector(".home-art")!.getBoundingClientRect();
          return { gap: Math.round(artBox.left - copy.right), left: Math.round(copy.left), right: Math.round(window.innerWidth - artBox.right) };
        });
        check(gap.gap <= 40 && Math.abs(gap.left - gap.right) <= 80, `UI-44 home: ${gap.gap}px between text and artwork, margins ${gap.left}/${gap.right}px`);
      }
      check(art.shown && art.lockup === "Lock-In" && art.inlineStyles === 0 && art.venue !== "" && art.moving === (motion === "no-preference"),
        `UI-32 home (${motion}): artwork shown ${art.shown}, lockup "${art.lockup}", ${art.inlineStyles} style attributes, venue colour "${art.venue}", animated ${art.moving}`);
      await homeCtx.close();
    }

    // UI-34: the Quizzes list has a title search and an All / Ready / Needs work filter
    const lib = await hostCtx.newPage();
    watch("library", lib);
    await lib.goto(`${PUBLIC}/host/build`);
    await lib.waitForSelector("#lib-search", { timeout: 5000 });
    const visibleTitles = () => lib.evaluate(() => [...document.querySelectorAll<HTMLElement>(".lib tbody tr")].filter((r) => !r.hidden).map((r) => r.querySelector(".lib-name a")?.textContent?.trim()).join(", "));
    const all = await visibleTitles();
    await lib.click('.lib-tools [role=radio]:has-text("Needs work")');
    const work = await visibleTitles();
    await lib.click('.lib-tools [role=radio]:has-text("All")');
    await lib.fill("#lib-search", "ready q");
    const searched = await visibleTitles();
    await lib.fill("#lib-search", "nothing like this");
    const none = await lib.evaluate(() => !(document.querySelector(".lib-none") as HTMLElement).hidden);
    await lib.fill("#lib-search", "");
    await lib.screenshot({ path: join(OUT, "ui-34-quizzes-search.png") });
    check(all === "Test Quiz, Ready Quiz" || all === "Ready Quiz, Test Quiz", `UI-34 all quizzes: ${all}`);
    check(work === "Test Quiz" && searched === "Ready Quiz" && none, `UI-34 Needs work: "${work}", search "ready q": "${searched}", no match says so: ${none}`);
    await lib.close();

    // UI-35: a loader, not "Loading…" text, while the quiz list loads
    const slow = await hostCtx.newPage();
    watch("slow library", slow);
    let letGo!: () => void;
    const gate = new Promise<void>((r) => { letGo = r; });
    await slow.route("**/api/quizzes", async (route) => { await gate; await route.continue(); });
    await slow.goto(`${PUBLIC}/host/build`);
    const loader = await slow.waitForSelector("#host-main .loading[role=status] .spin", { timeout: 5000 }).then(() => true, () => false);
    const loadingText = await slow.evaluate(() => {
      const main = document.getElementById("host-main")!.cloneNode(true) as HTMLElement;
      main.querySelectorAll(".visually-hidden").forEach((e) => e.remove());   // read out, not shown
      return /Loading/.test(main.textContent ?? "");
    });
    const label = await slow.evaluate(() => document.querySelector("#host-main .loading .visually-hidden")?.textContent ?? "");
    // UI-39: the page loader sits in the middle of the page column
    const offCentre = await slow.evaluate(() => {
      const spin = document.querySelector("#host-main .loading .spin")!.getBoundingClientRect();
      const nav = document.querySelector(".host-brand")!.getBoundingClientRect();
      const signOut = document.querySelector(".host-signout")!.getBoundingClientRect();
      return Math.abs((spin.left + spin.right) / 2 - (nav.left + signOut.right) / 2);
    });
    await slow.screenshot({ path: join(OUT, "ui-35-loading.png") });
    letGo();
    await slow.waitForSelector("#lib-search", { timeout: 5000 });
    check(loader && !loadingText && label === "Loading quizzes", `UI-35 the quiz list shows a loader (${loader}), no visible loading text (${!loadingText}), read out as "${label}"`);
    check(offCentre <= 2, `UI-39 the page loader is ${offCentre.toFixed(1)} px off the middle of the page column`);

    // UI-36: every console page starts at the nav's left edge, with the same top
    const edges: string[] = [];
    for (const path of ["/host/build", `/host/build?quiz=${ready.id}`, "/host/brand", "/host/history"]) {
      await slow.goto(`${PUBLIC}${path}`);
      await slow.waitForFunction(() => !!document.querySelector("#host-main h1"), null, { timeout: 5000 });
      edges.push(await slow.evaluate(() => {
        const nav = Math.round(document.querySelector(".host-brand")!.getBoundingClientRect().left);
        const h1 = Math.round(document.querySelector("#host-main h1")!.getBoundingClientRect().left);
        return `${location.pathname}${location.search} nav ${nav} title ${h1}`;
      }));
    }
    check(edges.every((e) => / nav (\d+) title \1$/.test(e)), `UI-36 ${edges.join("; ")}`);

    // UI-38: on a wide screen the pages are a centred 1200 px column; on a laptop at least 48 px each side
    const column = async (width: number) => {
      await slow.setViewportSize({ width, height: 900 });
      return slow.evaluate(() => {
        const nav = document.querySelector(".host-brand")!.getBoundingClientRect();
        const out = document.querySelector(".host-signout")!.getBoundingClientRect();
        const w = document.documentElement.clientWidth;
        return { left: Math.round(nav.left), right: Math.round(w - out.right) };
      });
    };
    const wide = await column(1600);
    const laptop = await column(1280);
    await slow.setViewportSize({ width: 1280, height: 900 });
    check(Math.abs(wide.left - wide.right) <= 16 && wide.left >= 190 && laptop.left >= 48,
      `UI-38 1600 px: ${wide.left} px left, ${wide.right} px right; 1280 px: ${laptop.left} px left`);

    // UI-37: selects are styled like the other fields
    await slow.goto(`${PUBLIC}/host/build?quiz=${ready.id}`);
    await slow.click('[role=tab]:has-text("Settings")');
    const sel = await slow.waitForSelector("#set-half", { timeout: 5000 }).then(() => slow.evaluate(() => {
      const cs = getComputedStyle(document.getElementById("set-half")!);
      // Where the browser can style the open list (customizable select), the chevron is its picker icon.
      const icon = cs.appearance === "base-select" ? getComputedStyle(document.getElementById("set-half")!, "::picker-icon").backgroundImage : cs.backgroundImage;
      return { appearance: cs.appearance, chevron: icon.includes("svg"), radius: cs.borderRadius };
    }));
    // UI-40: the open list is the design system's menu where the browser allows it
    let list = "native";
    if (sel.appearance === "base-select") {
      await slow.click("#set-half");
      list = await slow.evaluate(() => {
        const o = document.querySelector("#set-half option")!;
        const r = o.getBoundingClientRect();
        return `${getComputedStyle(o).backgroundColor} ${Math.round(r.height)}px`;
      });
      await slow.screenshot({ path: join(OUT, "ui-40-select-open.png") });
      await slow.keyboard.press("Escape");
    }
    await slow.locator("#set-half").screenshot({ path: join(OUT, "ui-37-select.png") });
    check((sel.appearance === "none" || sel.appearance === "base-select") && sel.chevron && sel.radius === "10px", `UI-37 select: appearance ${sel.appearance}, chevron ${sel.chevron}, radius ${sel.radius}`);
    check(list === "native" || / 44px$/.test(list), `UI-40 open list: ${list}`);
    await slow.close();

    // UI-33: Venue settings, Quiz defaults: a new quiz starts with the venue's rounds, questions and settings
    await brand.click('[role=tab]:has-text("Quiz defaults")');
    await brand.fill("#qd-rounds", "3");
    await brand.fill("#qd-questions", "2");
    // UI-46: Halftime in Quiz defaults says which round Halfway is and offers the rounds before the last
    const half = await brand.evaluate(() => [...document.querySelectorAll<HTMLOptionElement>("#qd-half option")].filter((o) => !o.hidden).map((o) => o.textContent?.trim()).join(" | "));
    check(half === "Halfway (after round 2) | No halftime | After round 1 | After round 2", `UI-46 Quiz defaults halftime for 3 rounds: ${half}`);
    await brand.fill("#qd-timer", "45");
    await brand.click('[aria-label="Joker"] [role=radio]:has-text("On")');
    await brand.click('form:visible button[type=submit]');
    await brand.waitForFunction(() => /saved/i.test(document.querySelector(".ok-box:not([hidden])")?.textContent ?? ""), null, { timeout: 5000 });
    await brand.screenshot({ path: join(OUT, "ui-33-quiz-defaults.png"), fullPage: true });
    const made = await brand.evaluate(async () => {
      const res = await fetch("/api/quizzes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Defaults Quiz" }) });
      const body = await res.json() as { quiz: { rounds: { questions: unknown[] }[]; settings: { timerSeconds: number; joker: boolean } } };
      return { rounds: body.quiz.rounds.length, questions: body.quiz.rounds.map((r) => r.questions.length).join("/"), timer: body.quiz.settings.timerSeconds, joker: body.quiz.settings.joker };
    });
    check(made.rounds === 3 && made.questions === "2/2/2" && made.timer === 45 && made.joker, `UI-33 a new quiz: ${made.rounds} rounds of ${made.questions} questions, timer ${made.timer} s, joker ${made.joker}`);

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
