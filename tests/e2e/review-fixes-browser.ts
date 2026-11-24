// Real-browser checks for the code review fixes (LI-001, LI-003, LI-007, LI-008), against the
// real server process (or the binary with LOCKIN_BIN). A Playwright tool like browser-night.ts,
// not a bun test.
//
//   bun tests/e2e/review-fixes-browser.ts [outDir]
//
// - LI-001: a TCP proxy between the phone and the server goes silent (keeps the sockets open,
//   forwards nothing). The phone must show "Offline" and come back on its own, without a close.
// - LI-003: night 1 shows a 1x1 picture; between nights the file is replaced by a 2x2 picture
//   under the same question id and file name. The same phone page (same cache) must show 2x2.
// - LI-008: a draft typed in night 1 must not appear in night 2 on the same phone page.
// - LI-007: the branding page's Save is held back; a name typed meanwhile must survive the reply.

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium, type Page } from "playwright";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type QuizFile } from "../../src/shared/formats.ts";
import { writeQuiz } from "../night/fakes.ts";
import { tempDataDir } from "../helpers/process.ts";
import { Night } from "./driver.ts";

const OUT = process.argv[2] ?? join(import.meta.dir, "../../dist/review-fixes-browser");
const PORT = 20000 + Math.floor(Math.random() * 2000);
const PROXY = PORT + 3000;
const PUBLIC = `http://127.0.0.1:${PROXY}`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/** A solid PNG of w x h pixels. */
function png(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (1 + w * 3) + 1 + x * 3);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

const quiz: QuizFile = {
  format: QUIZ_FORMAT, id: "review-fixes", title: "Review fixes", updatedAt: "2026-11-24T10:00:00.000Z",
  settings: { ...DEFAULT_QUIZ_SETTINGS, lockMode: "question", timerSeconds: 30, joker: false },
  rounds: [{ id: "r-rf000000", title: "Pictures", questions: [
    { id: "q-rfimg000", text: "Which album cover is this?", media: { kind: "image", file: "cover.png" }, answer: { type: "text", accepted: ["Abbey Road"] } },
  ] }],
  suddenDeath: [],
};

/** A TCP proxy that can go silent: sockets stay open, nothing is forwarded either way. */
function startProxy() {
  const state = { silent: false };
  Bun.listen<{ peer: any; buf: Uint8Array[] }>({
    hostname: "127.0.0.1", port: PROXY,
    socket: {
      async open(client) {
        client.data = { peer: null, buf: [] };
        client.data.peer = await Bun.connect<{ peer: any }>({
          hostname: "127.0.0.1", port: PORT,
          socket: {
            open(server) { server.data = { peer: client }; for (const b of client.data.buf) server.write(b); client.data.buf = []; },
            data(server, d) { if (!state.silent) server.data.peer.write(d); },
            close(server) { try { server.data.peer.end(); } catch { /* gone */ } },
            error() {},
          },
        });
      },
      data(client, d) {
        if (state.silent) return;
        if (client.data.peer) client.data.peer.write(d); else client.data.buf.push(new Uint8Array(d));
      },
      close(client) { try { client.data.peer?.end(); } catch { /* gone */ } },
      error() {},
    },
  });
  return state;
}

const problems: string[] = [];
const results: string[] = [];
const check = (ok: boolean, what: string) => { (ok ? results : problems).push(`${ok ? "PASS" : "FAIL"} ${what}`); };

async function main() {
  const dataDir = tempDataDir("lockin-review-fixes-");
  writeQuiz(dataDir, quiz, { "cover.png": png(1, 1, [200, 30, 30]) });
  const proxy = startProxy();
  const night = new Night(dataDir, { port: PORT, publicUrl: PUBLIC });
  await night.start();
  const browser = await chromium.launch();
  let silentPhase = false;
  const watch = (name: string, page: Page) => {
    page.on("pageerror", (e) => problems.push(`${name}: page error: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !(silentPhase && /WebSocket/i.test(m.text()))) problems.push(`${name}: console error: ${m.text()}`); });
  };
  try {
    // --- the phone: one page for both nights -----------------------------------------------
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await ctx.newPage();
    watch("phone", phone);
    const imgWidth = async () => {
      await phone.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>(".ph-main img, main img, img.qimg, .q-img img, img[alt]"); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 });
      return phone.evaluate(() => [...document.querySelectorAll<HTMLImageElement>("img")].filter((i) => i.src.includes("/media/q/")).map((i) => ({ w: i.naturalWidth, src: i.getAttribute("src") }))[0]);
    };

    const playNight = async (n: number) => {
      const { roomCode } = await night.cmd("night.open", { quizId: quiz.id }) as { roomCode: string };
      if (n === 1) await phone.goto(`${PUBLIC}/j/${roomCode}`);
      else {
        await phone.waitForSelector("#room-code", { timeout: 8000 });
        await phone.fill("#room-code", roomCode);
      }
      await phone.fill("#team-name", `Team night ${n}`);
      await phone.click(".ph-foot .btn.primary");
      await phone.waitForFunction((name) => document.querySelector(".ph-top .team")?.textContent === name, `Team night ${n}`, { timeout: 5000 });
      await night.cmd("quiz.start");
      await night.cmd("round.start");
      await night.cmd("question.next");
      await phone.waitForSelector("#a-q-rfimg000", { timeout: 5000 });
      return imgWidth();
    };

    // Night 1
    const first = await playNight(1);
    check(first?.w === 1, `LI-003 night 1 shows the 1x1 picture (${JSON.stringify(first)})`);
    await phone.fill("#a-q-rfimg000", "Abbey");       // typed, not sent
    await phone.screenshot({ path: join(OUT, "01-night1-draft.png") });

    // LI-001: the network goes silent; the phone must notice without a close event.
    // SKIP_SILENT=1 skips this part (to compare the other checks against an older build).
    if (!process.env.SKIP_SILENT) {
    silentPhase = true;
    proxy.silent = true;
    const t0 = Date.now();
    await phone.waitForFunction(() => document.body.innerText.includes("Offline. Reconnecting"), null, { timeout: 60_000 });
    const offlineAfter = Date.now() - t0;
    check(offlineAfter <= 47_000, `LI-001 phone shows Offline ${Math.round(offlineAfter / 1000)} s after the network went silent (bound 35 s + 5 s check + 2 s grace)`);
    await phone.screenshot({ path: join(OUT, "02-silent-offline.png") });
    proxy.silent = false;
    const t1 = Date.now();
    await phone.waitForFunction(() => !document.body.innerText.includes("Offline. Reconnecting"), null, { timeout: 30_000 });
    check(true, `LI-001 phone back online ${Math.round((Date.now() - t1) / 1000)} s after the network returned`);
    silentPhase = false;
    const draftAfter = await phone.inputValue("#a-q-rfimg000");
    check(draftAfter === "Abbey", `LI-008 the unfinished draft survives a reconnect in the same night (got "${draftAfter}")`);
    await phone.screenshot({ path: join(OUT, "03-back-online.png") });
    }

    await night.cmd("quiz.end", { early: true });
    await night.cmd("night.close");

    // Between nights the picture is replaced under the same question id and file name.
    writeQuiz(dataDir, quiz, { "cover.png": png(2, 2, [30, 30, 200]) });

    // Night 2 on the same page
    const second = await playNight(2);
    check(second?.w === 2, `LI-003 night 2 shows the new 2x2 picture without clearing the cache (${JSON.stringify(second)})`);
    check(first?.src !== second?.src, "LI-003 the picture's address changed between nights");
    const draft2 = await phone.inputValue("#a-q-rfimg000");
    check(draft2 === "", `LI-008 night 2 starts with an empty answer box (got "${draft2}")`);
    await phone.screenshot({ path: join(OUT, "04-night2.png") });
    await night.cmd("quiz.end", { early: true });
    await night.cmd("night.close");

    // --- LI-007: the branding page ----------------------------------------------------------
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const [cname, cvalue] = night.cookie.split("=");
    await hostCtx.addCookies([{ name: cname!, value: cvalue!, url: PUBLIC }]);
    const brand = await hostCtx.newPage();
    watch("brand", brand);
    await brand.goto(`${PUBLIC}/host/brand`);
    await brand.waitForSelector("#venue-name", { timeout: 5000 });
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    await brand.route("**/api/theme", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      await held;
      await route.continue();
    });
    await brand.fill("#venue-name", "The Hanks Arms");
    await brand.locator("#venue-name").locator("xpath=ancestor::form").locator("button[type=submit]").click();
    await brand.waitForFunction(() => document.body.innerText.includes("Saving…"), null, { timeout: 3000 });
    await brand.fill("#venue-name", "The Hanks Arms & Kitchen");   // typed while the save is on its way
    release();
    await brand.waitForFunction(() => !document.body.innerText.includes("Saving…"), null, { timeout: 5000 });
    await Bun.sleep(200);
    const kept = await brand.inputValue("#venue-name");
    const notSaved = await brand.evaluate(() => document.body.innerText.includes("Not saved yet"));
    check(kept === "The Hanks Arms & Kitchen", `LI-007 the name typed during the save is kept (got "${kept}")`);
    check(notSaved, "LI-007 the page still says Not saved yet");
    await brand.screenshot({ path: join(OUT, "05-brand-kept-edit.png") });
    const saved = await (await night.p.fetch("/api/theme", { cookie: night.cookie })).json() as { theme: { name: string } };
    check(saved.theme.name === "The Hanks Arms", `LI-007 the server has the name sent with Save (got "${saved.theme.name}")`);
  } finally {
    await browser.close();
    await night.stop();
  }
}

await main().catch((e) => { problems.push(`error: ${e instanceof Error ? e.stack : String(e)}`); });
for (const r of results) console.log(r);
for (const p of problems) console.log(p);
console.log(problems.length === 0 ? `all checks passed; screenshots in ${OUT}` : `${problems.length} problem(s)`);
process.exit(problems.length === 0 ? 0 : 1);
