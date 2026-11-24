// B2: the rules module plugs into the app as app.services.rules.
import { expect, test } from "bun:test";
import { rules } from "../../src/server/rules/index.ts";
import { startTestServer } from "../helpers/server.ts";

test("register() offers the rules to other modules", async () => {
  const s = await startTestServer();
  try {
    expect(s.app.services.rules).toBe(rules);
  } finally {
    await s.stop();
  }
});
