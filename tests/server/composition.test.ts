// Code review LI-020: services are built once per app in the composition root, required, and
// never shared between apps in one process.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rules } from "../../src/server/rules/index.ts";
import { Hub } from "../../src/server/ws.ts";
import { connectClient } from "../helpers/client.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";
import { fakeCopy, fakeRules, makeQuiz, q, text, writeQuiz } from "../night/fakes.ts";

const servers: TestServer[] = [];
afterAll(async () => { for (const s of servers) await s.stop(); });
async function server(opts: Parameters<typeof startTestServer>[0] = {}) {
  const s = await startTestServer(opts);
  servers.push(s);
  return s;
}

describe("composition root (LI-020)", () => {
  test("every service is there from the start, and the real rules are the default", async () => {
    const s = await server();
    const { services } = s.app;
    expect(services.rules).toBe(rules);
    for (const key of ["copyPicker", "branding", "quizStore", "displayPairing"] as const) expect(services[key]).toBeDefined();
  });

  test("two apps in one process never read or write each other's data folders", async () => {
    const a = await server();
    const b = await server();
    expect(a.app.services.branding).not.toBe(b.app.services.branding);
    expect(a.app.services.quizStore).not.toBe(b.app.services.quizStore);

    // A theme saved in one app is not the other's.
    const ca = await a.signIn();
    const res = await a.fetch("/api/theme", { method: "PUT", cookie: ca, body: JSON.stringify({ theme: { ...a.app.services.branding.theme(), name: "The Anchor" } }) });
    expect(res.status).toBe(200);
    expect(a.app.services.branding.venueName()).toBe("The Anchor");
    expect(b.app.services.branding.venueName()).toBeNull();

    // An accepted answer goes into the calling app's quiz file only (the removed module-global
    // helper wrote through whichever app registered last).
    const quiz = makeQuiz("shared-id", [[q(text("Paris"))]]);
    writeQuiz(a.dataDir, quiz);
    writeQuiz(b.dataDir, quiz);
    const qid = quiz.rounds[0]!.questions[0]!.id;
    await a.app.services.quizStore.saveAcceptedAnswer("shared-id", qid, "Paree");
    const read = (dir: string) => JSON.parse(readFileSync(join(dir, "quizzes", "shared-id", "quiz.json"), "utf8")).rounds[0].questions[0].answer.accepted;
    expect(read(a.dataDir)).toEqual(["Paris", "Paree"]);
    expect(read(b.dataDir)).toEqual(["Paris"]);

    // Pairings are per app too.
    a.app.services.displayPairing.issue();
    expect(a.app.services.displayPairing.pairedCount).toBe(1);
    expect(b.app.services.displayPairing.pairedCount).toBe(0);
  });

  test("tests substitute narrow fakes when the app is built, and the engine uses them", async () => {
    const copy = fakeCopy();
    const s = await server({ services: { rules: fakeRules, copyPicker: copy } });
    expect(s.app.services.rules).toBe(fakeRules);
    writeQuiz(s.dataDir, makeQuiz("fakes", [[q(text("x"))]]));
    const cookie = await s.signIn();
    const host = await connectClient(s, { role: "host", cookie });
    await host.hello();
    expect((await host.cmd("night.open", { quizId: "fakes" })).ok).toBe(true);
    expect(copy.calls.some((c) => c.key === "lobby")).toBe(true);
    host.close();
  });

  test("a socket hub missing a plug-in fails when the app is put together, not later", () => {
    const hub = new Hub({ clock: { now: () => 0 }, sessionAlive: () => false });
    expect(() => hub.assertWired()).toThrow("command handler, view provider, team token resolver, display authoriser");
    hub.setCommandHandler(() => ({ ok: true }));
    hub.setViewProvider(() => { throw new Error("unused"); });
    hub.setTeamTokenResolver(() => null);
    expect(() => hub.assertWired()).toThrow("display authoriser");
    hub.setDisplayAuthoriser(() => {});
    expect(() => hub.assertWired()).not.toThrow();
  });
});
