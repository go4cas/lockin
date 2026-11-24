// Renders every wireframe frame to PNG with Playwright (docs tooling, not app code).
// Usage: node docs/design/tools/render.js [outDir]
// Needs Playwright with Chromium installed on the machine running it.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "..", "wireframes");
const out = path.resolve(process.argv[2] || path.join(__dirname, "..", "img"));
const sets = [
  { page: "display.html", w: 1280, h: 720, prefix: "display" },
  { page: "phone.html", w: 390, h: 844, prefix: "phone", dsf: 2 },
  { page: "host.html", w: 1366, h: 768, prefix: "host" },
];
const extra = (process.env.EXTRA || "").split(";").filter(Boolean); // e.g. "display.html|lobby|brass-and-oak|1280|720"
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const shoot = async (page, id, theme, w, h, dsf, file) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf || 1 });
    const url = "file://" + path.join(root, page) + "?s=" + id + (theme ? "&theme=" + theme : "");
    await p.goto(url);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(1200); // let entry animations settle
    await p.screenshot({ path: path.join(out, file) });
    await p.close();
  };
  for (const s of sets) {
    const p = await b.newPage();
    await p.goto("file://" + path.join(root, s.page));
    const ids = await p.$$eval(".screen", (els) => els.map((e) => e.id));
    await p.close();
    for (const id of ids) await shoot(s.page, id, null, s.w, s.h, s.dsf, `${s.prefix}-${id}.png`);
  }
  for (const e of extra) {
    const [page, id, theme, w, h] = e.split("|");
    await shoot(page, id, theme, +w, +h, 1, `${page.replace(".html", "")}-${id}--${theme}.png`);
  }
  await b.close();
})();
