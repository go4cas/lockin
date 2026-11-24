// A host mark on a team that sent no answer survives in the history detail (code review LI-006).
import { afterEach, describe, expect, test } from "bun:test";
import type { HistoryDetail } from "../../src/shared/protocol.ts";
import { connectClient, type TestClient } from "../helpers/client.ts";
import { FakeClock } from "../helpers/fake-clock.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";
import { fakeCopy, fakeRules, makeQuiz, number, q, text, writeQuiz } from "../night/fakes.ts";

const open: TestClient[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  while (open.length) open.pop()!.close();
  while (servers.length) await servers.pop()!.stop();
});

async function client(s: TestServer, role: "host" | "team", cookie?: string) {
  const c = await connectClient(s, { role, cookie });
  open.push(c);
  await c.hello({});
  return c;
}
async function ok(c: TestClient, name: string, args: object = {}) {
  const ack = await c.cmd(name, args);
  if (!ack.ok) throw new Error(`${name}: ${JSON.stringify(ack.error)}`);
  return ack.result as any;
}

async function setup(dataDir?: string) {
  const s = await startTestServer({ clock: new FakeClock(), dataDir, keepData: true });
  servers.push(s);
  s.app.services.rules = fakeRules;
  s.app.services.copyPicker = fakeCopy();
  return s;
}

describe("history detail for a team with no answer (LI-006)", () => {
  test("a Right mark on a missing answer comes back as a no-answer row with its mark, also after a restart", async () => {
    const s = await setup();
    const qs = [q(text("Fleetwood Mac")), q(number(0))];
    const quiz = makeQuiz("no-answer", [qs]);
    writeQuiz(s.dataDir, quiz);
    const cookie = await s.signIn();
    const host = await client(s, "host", cookie);
    const { roomCode, nightId } = await ok(host, "night.open", { quizId: quiz.id });
    const silent = await client(s, "team");
    const { teamId: silentId } = await ok(silent, "team.join", { roomCode, name: "Silent Team" });
    const zero = await client(s, "team");
    const { teamId: zeroId } = await ok(zero, "team.join", { roomCode, name: "Zero Heroes" });
    await ok(host, "quiz.start");
    await ok(host, "round.start");
    await ok(host, "question.next");
    await ok(host, "lock");                                   // nobody answered question 1
    await ok(host, "question.next");
    await ok(zero, "answer.submit", { questionId: qs[1]!.id, value: { type: "number", value: 0 } });
    await ok(host, "lock");
    await ok(host, "mark.team", { questionId: qs[0]!.id, teamId: silentId, mark: "correct" });   // they told the host

    const detail = async (srv: TestServer, c = cookie) => { const r = await srv.fetch(`/api/history/${nightId}`, { cookie: c }); const j = await r.json(); if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(j)}`); return j as HistoryDetail; };
    const check = (d: HistoryDetail) => {
      const row = d.answers.find((a) => a.teamId === silentId && a.questionId === qs[0]!.id);
      expect(row).toMatchObject({ mark: "correct", noAnswer: true, display: "" });
      const zeroRow = d.answers.find((a) => a.teamId === zeroId && a.questionId === qs[1]!.id)!;
      expect(zeroRow.display).toBe("0");                 // a real answer of zero is not "no answer"
      expect(zeroRow.noAnswer).toBeUndefined();
      expect(d.standings.find((x) => x.teamId === silentId)!.total).toBe(1);
    };
    check(await detail(s));
    const dataDir = s.dataDir;
    while (open.length) open.pop()!.close();
    await servers.pop()!.stop();
    const s2 = await setup(dataDir);
    check(await detail(s2, await s2.signIn()));
  });
});
