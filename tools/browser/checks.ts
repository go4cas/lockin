// All of Lock-In's real-browser checks in one command (code review LI-018), as CI runs them:
//
//   bun install --cwd tools/browser --frozen-lockfile
//   bun run --cwd tools/browser install-browser      (Chromium for the pinned Playwright)
//   bun run --cwd tools/browser checks [outDir]      (default dist/browser-checks)
//
// 1. tests/e2e/browser-night.ts, lock per question, then per round: login page, display
//    pairing, phones join from the QR link and answer through their UI, kill -9 mid-question
//    and reconnect, marking, reveal, sudden death, winner, history, close.
// 2. tests/e2e/review-fixes-browser.ts: a silent network, a picture changed between two
//    nights, a phone draft across nights, a branding save race.
// 3. tests/display/stress.cjs on the fixture server: 400 random phase changes per seed.
// Each fails on page errors, console errors, failed requests or a stuck screen. Screenshots
// go to outDir. These are integration checks; physical phone and TV sign-off stays a
// separate release task, and the screenshot harnesses (tests/phone/tools/render.cjs,
// tests/display/screenshots.cjs) mock the server and only show presentation.

import { join, resolve } from "node:path";
import { startFixtureServer } from "../../scripts/fixture-server.ts";

const ROOT = resolve(import.meta.dir, "../..");
const OUT = resolve(ROOT, process.argv[2] ?? "dist/browser-checks");   // relative to the repository root

async function step(name: string, cmd: string[]): Promise<boolean> {
  const t0 = Date.now();
  console.log(`\n=== ${name}: ${cmd.join(" ")}`);
  const p = Bun.spawn(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  const code = await p.exited;
  console.log(`=== ${name}: ${code === 0 ? "passed" : `FAILED (exit ${code})`} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return code === 0;
}

const results: [string, boolean][] = [];
results.push(["night, lock per question", await step("night, lock per question", ["bun", "tests/e2e/browser-night.ts", join(OUT, "night-question"), "question"])]);
results.push(["night, lock per round", await step("night, lock per round", ["bun", "tests/e2e/browser-night.ts", join(OUT, "night-round"), "round"])]);
results.push(["review fixes", await step("review fixes", ["bun", "tests/e2e/review-fixes-browser.ts", join(OUT, "review-fixes")])]);

const port = 18500 + Math.floor(Math.random() * 1000);
const fixtures = await startFixtureServer(port, () => {});
try {
  results.push(["display stress", await step("display stress", ["node", "tests/display/stress.cjs", `http://127.0.0.1:${port}`, "1,2,3"])]);
} finally {
  fixtures.stop(true);
}

console.log("\nBrowser checks:");
for (const [name, ok] of results) console.log(`  ${ok ? "pass" : "FAIL"}  ${name}`);
console.log(`Screenshots in ${OUT}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
