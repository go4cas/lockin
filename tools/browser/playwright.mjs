// ES module entry for the TypeScript checks; see playwright.cjs.
import { createRequire } from "node:module";
const pw = createRequire(import.meta.url)("./playwright.cjs");
export const chromium = pw.chromium;
