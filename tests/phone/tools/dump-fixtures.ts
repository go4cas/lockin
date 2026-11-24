// Prints the team view fixtures as JSON for render.cjs (Node can't import the .ts fixtures).
import { loadFixtures } from "../../fixtures/views/index.ts";
import { NOW } from "../../fixtures/views/_data.ts";
const views: Record<string, unknown> = {};
for (const [k, v] of await loadFixtures()) if (k.startsWith("team/")) views[k] = v;
process.stdout.write(JSON.stringify({ NOW, views }));
