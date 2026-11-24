// B5: the Run night console's pure helpers, checked against every host view fixture (TECH-SPEC 13.2).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  acceptedList, answerValueText, can, cleanPrizes, clockText, displayNow, endAction, ordinal, pickMarkingQuestion,
  plannedFromInput, primaryAction, sortGroups, steps, timerLeft, topTitle,
} from "../../public/host/run/logic.js";
import { COMMAND_NAMES, PHASES, type CommandName, type HostView } from "../../src/shared/protocol.ts";
import { NOW, textGroups, timer } from "../fixtures/views/_data.ts";
import { loadFixtures } from "../fixtures/views/index.ts";

const fixtures = await loadFixtures();
const host = [...fixtures].filter(([name]) => name.startsWith("host/")) as [string, HostView][];
const view = (name: string) => structuredClone(fixtures.get(`host/${name}`)) as HostView;

describe("every host fixture", () => {
  test("there is a host fixture for every phase", () => {
    expect(new Set(host.map(([, v]) => v.phase))).toEqual(new Set(PHASES));
  });

  for (const [name, v] of host) {
    test(`${name}: title, display line and steps render without throwing`, () => {
      expect(topTitle(v).title.length).toBeGreaterThan(0);
      expect(typeof displayNow(v)).toBe("string");
      expect(Array.isArray(steps(v))).toBe(true);
    });

    test(`${name}: the next-step button only offers a command the server allows`, () => {
      const a = primaryAction(v);
      if (a) {
        expect(COMMAND_NAMES).toContain(a.name);
        if (!(v.phase === "marking" && a.name === "reveal.start")) expect(v.can[a.name]).toBe(true);
        expect(a.label.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("primaryAction picks the obvious next step", () => {
  const expected: Record<string, CommandName | null> = {
    idle: null, lobby: "quiz.start", round_intro: "round.start", asking: "lock", "asking-round": "lock",
    reveal: "reveal.next", leaderboard: "round.next", "leaderboard-30": "round.next", "leaderboard-last": "sd.start",
    halftime: "round.next", sudden_death: "sd.reveal", ended: "night.close",
  };
  for (const [name, cmd] of Object.entries(expected)) {
    test(`${name} -> ${cmd}`, () => expect(primaryAction(view(name))?.name ?? null).toBe(cmd));
  }

  test("marking with answers left shows Reveal, blocked, with the count", () => {
    const a = primaryAction(view("marking"));
    expect(a?.name).toBe("reveal.start");
    expect(a?.hint).toBe("2 answers left to mark before the reveal.");
    expect(can(view("marking"), "reveal.start")).toBe(false);
  });

  test("per-question: a locked question with more to come offers the next question", () => {
    const v = view("asking");
    v.can = { "question.next": true, "mark.group": true };
    expect(primaryAction(v)).toMatchObject({ name: "question.next", label: "Show question 3" });
  });

  test("per-round: after the last question, the round timer comes before lock", () => {
    const v = view("asking-round");
    v.can = { "timer.start": true, lock: true };
    expect(primaryAction(v)).toMatchObject({ name: "timer.start", label: "Start the round timer" });
  });

  test("every question locked: Finish the round wins", () => {
    const v = view("asking");
    v.can = { "round.finish": true, "question.next": false };
    expect(primaryAction(v)?.name).toBe("round.finish");
  });

  test("reveal of the last answer leads to the leaderboard", () => {
    const v = view("reveal");
    v.reveal!.question.number = 5;
    expect(primaryAction(v)?.label).toBe("Show the leaderboard");
  });

  test("leaderboard after the halftime round offers halftime", () => {
    expect(primaryAction(view("leaderboard"))?.label).toBe("Go to halftime");
  });

  test("nothing allowed: no button", () => {
    const v = view("lobby");
    v.can = {};
    expect(primaryAction(v)).toBeNull();
  });
});

describe("ending the quiz", () => {
  test("early from the middle of the night, with confirmation", () => {
    expect(endAction(view("halftime"))).toMatchObject({ name: "quiz.end", args: { early: true }, confirm: true });
  });
  test("normal after the last round's leaderboard", () => {
    const v = view("leaderboard-last");
    v.can["quiz.end"] = true;
    expect(endAction(v)).toMatchObject({ args: {}, label: "End the quiz" });
  });
  test("not offered when the server does not allow it", () => {
    expect(endAction(view("leaderboard-last"))).toBeNull();
    expect(endAction(view("lobby"))).toBeNull();
  });
});

describe("marking helpers", () => {
  test("pending groups first, nearest match first", () => {
    expect(sortGroups(textGroups()).map((g) => g.key)).toEqual(["fleetwod mac", "mac", "fleetwood mac"]);
  });
  test("the first question with pending answers opens first, and the host's pick sticks", () => {
    const qs = view("marking").marking!.questions;
    expect(pickMarkingQuestion(qs, null)).toBe(qs[0]!.question.id);
    expect(pickMarkingQuestion(qs, qs[3]!.question.id)).toBe(qs[3]!.question.id);
    expect(pickMarkingQuestion(qs, "gone")).toBe(qs[0]!.question.id);
    expect(pickMarkingQuestion([], null)).toBeNull();
  });
  test("accepted answers list for text, the answer text otherwise", () => {
    const q = view("asking").current!;
    expect(acceptedList(q)).toEqual(["A. Aretha Franklin"]);
    expect(acceptedList(view("marking").marking!.questions[0]!.question)).toEqual(["Fleetwood Mac"]);
  });
});

describe("steps line", () => {
  test("per-question asking", () => {
    expect(steps(view("asking")).map((s) => `${s.label}:${s.state}`)).toEqual([
      "Q1 locked:done", "Q2 timer running:now", "Q3:todo", "Q4:todo", "Q5:todo", "Mark:todo", "Reveal:todo", "Leaderboard:todo", "Halftime:todo",
    ]);
  });
  test("reveal marks the answer on screen", () => {
    expect(steps(view("reveal")).slice(0, 3).map((s) => `${s.label}:${s.state}`)).toEqual(["Q1:done", "Q2 answer:now", "Q3:todo"]);
  });
});

describe("timer and time helpers", () => {
  test("running, paused, idle and done", () => {
    expect(timerLeft(timer.running(60, 42), NOW)).toBe(42_000);
    expect(timerLeft(timer.paused(300, 140), NOW)).toBe(140_000);
    expect(timerLeft(timer.idle(60), NOW)).toBe(60_000);
    expect(timerLeft(timer.done(), NOW)).toBe(0);
    expect(timerLeft(timer.running(60, 1), NOW + 5000)).toBe(0);
  });
  test("clock text", () => {
    expect(clockText(42_000)).toBe("0:42");
    expect(clockText(140_000)).toBe("2:20");
    expect(clockText(400)).toBe("0:01");
    expect(clockText(0)).toBe("0:00");
  });
  test("planned start from a time input", () => {
    const now = new Date(2026, 10, 20, 18, 0).getTime();
    expect(plannedFromInput("19:30", now)).toBe(new Date(2026, 10, 20, 19, 30).getTime());
    expect(plannedFromInput("17:30", now)).toBe(new Date(2026, 10, 20, 17, 30).getTime());   // just past: still tonight
    expect(plannedFromInput("09:00", now)).toBe(new Date(2026, 10, 21, 9, 0).getTime());     // long past: tomorrow
    expect(plannedFromInput("25:00", now)).toBeNull();
    expect(plannedFromInput("soon", now)).toBeNull();
  });
  test("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
});

describe("prizes and answers", () => {
  test("blank prize rows drop out and places renumber", () => {
    expect(cleanPrizes([{ text: " Bar tab " }, { text: "" }, { text: "Chips" }])).toEqual([{ place: 1, text: "Bar tab" }, { place: 2, text: "Chips" }]);
    expect(cleanPrizes([{ text: "x".repeat(100) }])[0]!.text.length).toBe(80);
  });
  test("answer text from the history API", () => {
    expect(answerValueText(null)).toBe("no answer");
    expect(answerValueText("Paris")).toBe("Paris");
    expect(answerValueText({ display: "B. Paris" })).toBe("B. Paris");
  });
});

describe("console code", () => {
  const dir = join(import.meta.dir, "../../public/host/run");
  const files = ["app.js", "asking.js", "deadlock.js", "lobby.js", "logic.js", "marking.js", "results.js", "state.js", "teams.js", "ui.js"];
  const code = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");

  test("every command it sends is a real command", () => {
    const used = new Set([...code.matchAll(/(?:send|cmdButton|enabled|can)\(\s*(?:[a-z]+,\s*)?"([a-z]+\.?[a-zA-Z]*)"/g)].map((m) => m[1]!));
    for (const m of code.matchAll(/name: "([a-z]+\.?[a-zA-Z]*)"/g)) used.add(m[1]!);
    expect(used.size).toBeGreaterThan(20);
    for (const name of used) expect(COMMAND_NAMES).toContain(name as never);
  });

  test("every host command in TECH-SPEC 7.2 has a control", () => {
    const hostCommands = COMMAND_NAMES.filter((c) => !["team.join", "team.rejoin", "joker.play", "answer.submit"].includes(c));
    for (const c of hostCommands) expect(code).toContain(`"${c}"`);
  });

  test("Arrow comes from the vendored path only", () => {
    const imports = [...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
    for (const i of imports) expect(i === "/vendor/arrow/index.mjs" || i.startsWith("./")).toBe(true);
  });
});
