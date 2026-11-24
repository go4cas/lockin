// B9 load test (TECH-SPEC 13.4, S-11): 30 simulated teams, one display and one host
// connection play a full 6×5 quiz against a real server process. Every answer is
// acknowledged and stored, and the host sees each answer count within 1 s.
// Every display and team view is also checked against the privacy rules (10.3).
//
// Runs the source by default; LOCKIN_BIN=dist/lockin-linux-x64 runs the built binary.
// LOCKIN_LOAD_TEAMS changes the team count (max 30, the quiz's maxTeams limit).

import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { DEFAULT_QUIZ_SETTINGS, QUIZ_FORMAT, type AnswerSpec, type Question, type QuizFile } from "../../src/shared/formats.ts";
import type { DisplayView, HistoryDetail, HostView, ServerMsg } from "../../src/shared/protocol.ts";
import type { AnswerValue } from "../../src/shared/rules-api.ts";
import { writeQuiz } from "../night/fakes.ts";
import { PrivacyWatch } from "../helpers/privacy.ts";
import { tempDataDir } from "../helpers/process.ts";
import { Night, ok, waitFor } from "../e2e/driver.ts";

const TEAMS = Math.min(30, Number(process.env.LOCKIN_LOAD_TEAMS ?? 30));
const ROUNDS = 6;
const PER_ROUND = 5;
const OPTIONS = ["Paris", "Rome", "Oslo", "Bern"];

function makeQuiz(): QuizFile {
  const rounds = Array.from({ length: ROUNDS }, (_, r) => ({
    id: `r-load000${r}`,
    title: `Round ${r + 1}`,
    questions: Array.from({ length: PER_ROUND }, (_, i): Question => {
      const kind = (r * PER_ROUND + i) % 3;
      const answer: AnswerSpec = kind === 0 ? { type: "text", accepted: [`load${r}x${i}z`] }
        : kind === 1 ? { type: "choice", options: OPTIONS, correct: (r + i) % 4 }
        : { type: "number", value: r * 10 + i };
      return { id: `q-ld${r}${i}0000`, text: `Load question ${r + 1}.${i + 1}?`, answer, ...(r === 1 && i === 0 ? { timerSeconds: 10 } : {}) };
    }),
  }));
  return {
    format: QUIZ_FORMAT, id: "load-6x5", title: "Load 6x5", updatedAt: "2026-11-24T10:00:00.000Z",
    settings: { ...DEFAULT_QUIZ_SETTINGS, lockMode: "question", timerSeconds: 60, joker: true, maxTeams: 30 },
    rounds, suddenDeath: [],
  };
}

/** Team t's answer: right about 2 times in 3, typed answers in a handful of variants so they group. */
function answerFor(spec: AnswerSpec, t: number, r: number, i: number): AnswerValue {
  const right = (t + r + i) % 3 !== 0;
  switch (spec.type) {
    case "text": return { type: "text", text: right ? spec.accepted[0]! : `miss${t % 4}r${r}q${i}` };
    case "choice": return { type: "choice", index: right ? spec.correct : (spec.correct + 1) % 4 };
    case "number": return { type: "number", value: right ? spec.value : spec.value + 1 + (t % 3) };
    default: throw new Error("unused");
  }
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test(`load: ${TEAMS} teams play a full ${ROUNDS}×${PER_ROUND} quiz against the real server process`, async () => {
  const dataDir = tempDataDir("lockin-load-");
  dirs.push(dataDir);
  const quiz = makeQuiz();
  writeQuiz(dataDir, quiz);
  const watch = new PrivacyWatch();
  for (const qq of quiz.rounds.flatMap((r) => r.questions)) if (qq.answer.type === "text") watch.secret(qq.answer.accepted[0]!, qq.id);

  const night = new Night(dataDir);
  const started = Date.now();
  await night.start();
  // Host state arrival times, to measure how long each answer takes to show in the host's count.
  const hostSeen: { at: number; qid: string; answered: number }[] = [];
  night.host.ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data)) as ServerMsg;
    if (m.t === "state" && (m.view as HostView).current) {
      const cur = (m.view as HostView).current!;
      hostSeen.push({ at: Date.now(), qid: cur.id, answered: cur.answered });
    }
  });

  const latency: number[] = [];   // ms from a team sending an answer to the host's count including it
  const ackMs: number[] = [];     // ms from sending an answer to its ack
  let submitted = 0;
  let changes = 0;
  const finalValue = new Map<string, AnswerValue>();   // `${teamId}:${qid}` -> last value sent

  try {
    const { roomCode } = await night.cmd("night.open", { quizId: quiz.id }) as { roomCode: string };
    await Promise.all(Array.from({ length: TEAMS }, (_, t) => night.join(roomCode, `Load Team ${String(t + 1).padStart(2, "0")}`)));
    await waitFor<DisplayView>(night.display, (v) => v.teams.length === TEAMS, "all teams on the display");
    // a third of the teams play their joker on round 1 from the lobby
    await Promise.all(night.phones.filter((_, t) => t % 3 === 0).map((p) => ok(p.c, "joker.play", { round: 0 })));
    await night.cmd("quiz.start");

    for (let r = 0; r < ROUNDS; r++) {
      await night.cmd("round.start");
      for (let i = 0; i < PER_ROUND; i++) {
        const qq = quiz.rounds[r]!.questions[i]!;
        await night.cmd("question.next");
        const timed = r === 1 && i === 0;   // one question locks on the real timer, answers arriving while it runs
        if (timed) await night.cmd("timer.start");

        // every team answers within ~0.7 s, spread out like a room; some change their answer
        const firstSend = new Map<string, number>();
        await Promise.all(night.phones.map(async (p, t) => {
          await Bun.sleep(Math.random() * 700);
          const send = async (value: AnswerValue) => {
            if (value.type === "text") watch.guess(p.teamId, value.text);
            const t0 = Date.now();
            if (!firstSend.has(p.teamId)) firstSend.set(p.teamId, t0);
            const ack = await p.c.cmd("answer.submit", { questionId: qq.id, value });
            ackMs.push(Date.now() - t0);
            if (!ack.ok) throw new Error(`${p.name} ${qq.id}: ${JSON.stringify(ack.error)}`);
            submitted++;
            finalValue.set(`${p.teamId}:${qq.id}`, value);
          };
          const v = answerFor(qq.answer, t, r, i);
          if (t % 10 === 9) {   // change of mind: a wrong answer first, then the real one
            await send(answerFor(qq.answer, t + 1, r, i));
            changes++;
            await Bun.sleep(100);
          }
          await send(v);
        }));
        const hv = await waitFor<HostView>(night.host, (v) => v.current?.id === qq.id && v.current.answered === TEAMS, "every answer counted on the host", 5000);
        expect(hv.current!.answered).toBe(TEAMS);
        // latency for the k-th answer: the host's first state counting k answers, minus the k-th send time
        const order = [...firstSend.values()].sort((a, b) => a - b);
        const seen = hostSeen.filter((h) => h.qid === qq.id);
        for (let k = 1; k <= TEAMS; k++) {
          const s = seen.find((h) => h.answered >= k)!;
          latency.push(s.at - order[k - 1]!);
        }
        if (timed) await waitFor<HostView>(night.host, (v) => v.current!.status === "locked", "timer to run out", 15_000);
        else await night.cmd("lock");
      }
      await night.cmd("round.finish");
      // mark every pending typed group: the accepted spelling is right, the rest wrong
      for (const m of night.hostView().marking!.questions) {
        for (const g of m.groups.filter((x) => x.mark === "pending")) {
          await ok(night.host, "mark.group", { questionId: m.question.id, key: g.key, mark: "wrong" });
        }
      }
      expect(night.hostView().marking!.pendingTotal).toBe(0);
      await night.cmd("reveal.start");
      for (let i = 0; i < PER_ROUND; i++) await night.cmd("reveal.next");
      expect(night.hostView().phase).toBe("leaderboard");
      if (r < ROUNDS - 1) {
        await night.cmd("round.next");
        if (night.hostView().phase === "halftime") await night.cmd("round.next");
      }
    }
    await night.cmd("quiz.end");
    await waitFor<DisplayView>(night.display, (d) => d.phase === "ended" && !!d.final, "final");

    // every answer is stored, with the last value each team sent
    const h = (await (await night.p.fetch(`/api/history/${night.hostView().night!.id}`, { cookie: night.cookie })).json()) as HistoryDetail;
    expect(h.answers.length).toBe(TEAMS * ROUNDS * PER_ROUND);
    expect(finalValue.size).toBe(TEAMS * ROUNDS * PER_ROUND);
    expect(h.answers.every((a) => a.mark !== "pending")).toBe(true);
    for (const a of h.answers.filter((x) => quiz.rounds.flatMap((r) => r.questions).find((q) => q.id === x.questionId)!.answer.type === "text")) {
      expect(a.display).toBe((finalValue.get(`${a.teamId}:${a.questionId}`) as { text: string }).text);
    }
    // scores match an independent count of the right answers (joker doubles)
    const hv = night.hostView();
    const jokers = new Map(hv.teams.map((t) => [t.id, t.jokerRound]));
    const qRound = new Map(quiz.rounds.flatMap((r, ri) => r.questions.map((q) => [q.id, ri] as const)));
    const expected = new Map<string, number>();
    for (const a of h.answers) if (a.mark === "correct") expected.set(a.teamId, (expected.get(a.teamId) ?? 0) + (jokers.get(a.teamId) === qRound.get(a.questionId) ? 2 : 1));
    for (const row of h.standings) expect(row.total).toBe(expected.get(row.teamId) ?? 0);

    const report = watch.check(night.all);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const rss = (await Bun.$`ps -o rss= -p ${night.p.proc.pid}`.text()).trim();
    console.log([
      `[load] ${night.p.target}: ${TEAMS} teams, ${ROUNDS}x${PER_ROUND} quiz, ${elapsed} s`,
      `  answers: ${submitted} acked ok (${changes} changes), ${h.answers.length} stored, 0 dropped`,
      `  host count latency (send -> host sees it), ms: p50 ${pct(latency, 50)}, p95 ${pct(latency, 95)}, p99 ${pct(latency, 99)}, max ${Math.max(...latency)} (n=${latency.length})`,
      `  answer ack, ms: p50 ${pct(ackMs, 50)}, p95 ${pct(ackMs, 95)}, max ${Math.max(...ackMs)}`,
      `  host states: ${night.host.received.filter((m) => m.t === "state").length}; display states: ${report.checked.display}; team states: ${report.checked.team}`,
      `  server RSS at end: ${Math.round(Number(rss) / 1024)} MB`,
      `  privacy problems: ${report.problems.length}`,
    ].join("\n"));
    expect(report.problems).toEqual([]);
    expect(Math.max(...latency)).toBeLessThan(1000);
  } catch (e) {
    console.error(night.p?.log().slice(-4000));
    throw e;
  } finally {
    await night.stop();
  }
}, 240_000);
