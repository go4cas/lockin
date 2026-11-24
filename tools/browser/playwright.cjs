// The one way Lock-In's browser checks load Playwright (code review LI-018): the version
// pinned in tools/browser/package.json and bun.lock, never a global install. Says plainly
// what to run when it or its Chromium is missing.
"use strict";
const HELP = [
  "Playwright for Lock-In's browser checks is not installed. From the repository root run:",
  "  bun install --cwd tools/browser --frozen-lockfile",
  "  bun run --cwd tools/browser install-browser",
].join("\n");
const path = require("path");
let pw;
try {
  // by path, so a global install (NODE_PATH) is never picked up by mistake
  pw = require(path.join(__dirname, "node_modules", "playwright"));
} catch (e) {
  if (e && e.code === "MODULE_NOT_FOUND") {
    console.error(HELP);
    process.exit(2);
  }
  throw e;
}
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (opts) => {
  try {
    return await launch(opts);
  } catch (e) {
    if (/Executable doesn't exist|playwright install/i.test(String(e && e.message))) {
      console.error(HELP);
      process.exit(2);
    }
    throw e;
  }
};
module.exports = pw;
