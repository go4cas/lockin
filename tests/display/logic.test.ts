// B6: the display's pure helpers (public/display/logic.mjs).
import { describe, expect, test } from "bun:test";
import { loadFixtures } from "../fixtures/views/index.ts";
import { NOW, night, standings, timer } from "../fixtures/views/_data.ts";
import type { DisplayView } from "../../src/shared/protocol.ts";
import {
  FLASH_MS, PAGE_HOLD_MS, ROW_GAP_MS,
  boardLayout, choiceIndex, countdownText, endStage, footerLine, holdingPanels, isHolding, lockShouldSnap,
  movement, ordinal, pageBrand, questionSize, revealProgress, screenFor, themeReloadDue, timerNow, wonTieBreak,
} from "../../public/display/logic.mjs";

const MIN = 60_000;

describe("screenFor: every display fixture has a screen (T-01..T-12)", async () => {
  const fixtures = await loadFixtures();
  const expected: Record<string, string> = {
    "display/idle": "idle",
    "display/lobby": "lobby",
    "display/lobby-holding": "holding",
    "display/round_intro": "round",
    "display/asking": "question",
    "display/asking-image": "question",
    "display/asking-round": "question",
    "display/asking-locked": "locked",
    "display/marking": "marking",
    "display/reveal": "reveal",
    "display/leaderboard": "leaderboard",
    "display/leaderboard-20": "leaderboard",
    "display/leaderboard-30": "leaderboard",
    "display/halftime": "halftime",
    "display/sudden_death": "dl-question",
    "display/sudden_death-revealed": "dl-result",
    "display/ended": "ended",
  };
  const names = [...fixtures.keys()].filter((n) => n.startsWith("display/"));
  test("the list covers every display fixture", () => expect(names.sort()).toEqual(Object.keys(expected).sort()));
  for (const name of names) {
    test(name, () => expect(screenFor(fixtures.get(name) as DisplayView, NOW)).toBe(expected[name]!));
  }
  test("no view yet", () => expect(screenFor(null, NOW)).toBe("connecting"));
});

describe("lobby and the holding page (T-02, T-12, TECH-SPEC 7.4)", () => {
  test("plain lobby before holdingFrom, holding page from it, never after Quiz Start", () => {
    const n = night({ plannedStart: NOW + 40 * MIN, holdingFrom: NOW + 10 * MIN });
    expect(isHolding(n, NOW)).toBe(false);
    expect(isHolding(n, NOW + 10 * MIN)).toBe(true);
    expect(isHolding({ ...n, started: true }, NOW + 10 * MIN)).toBe(false);
    expect(isHolding({ ...n, plannedStart: null, holdingFrom: null }, NOW)).toBe(false);
  });

  test("panels keep the venue's order and skip ones with nothing to show (H-17)", () => {
    const n = night();
    expect(holdingPanels(n, 6)).toEqual(["countdown", "teams", "join", "install", "animation", "prizes"]);
    expect(holdingPanels({ ...n, prizes: [], plannedStart: null }, 0)).toEqual(["join", "install", "animation"]);
    expect(holdingPanels({ ...n, holdingPanels: ["prizes", "countdown"] }, 6)).toEqual(["prizes", "countdown"]);
    expect(holdingPanels({ ...n, holdingPanels: ["countdown", "fireworks" as never] }, 6)).toEqual(["countdown"]);
  });

  test("countdown from server time, then null (\"Starting soon\")", () => {
    expect(countdownText(NOW + 25 * MIN, NOW)).toBe("25:00");
    expect(countdownText(NOW + 61_500, NOW)).toBe("1:02");
    expect(countdownText(NOW + 2 * 3600_000 + 5000, NOW)).toBe("2:00:05");
    expect(countdownText(NOW + 400, NOW)).toBe("0:01");
    expect(countdownText(NOW, NOW)).toBeNull();
    expect(countdownText(NOW - 5000, NOW)).toBeNull();
    expect(countdownText(null, NOW)).toBeNull();
  });
});

describe("question (T-03)", () => {
  test("size steps by length and picture", () => {
    expect(questionSize("x".repeat(90), false)).toBe("l");
    expect(questionSize("x".repeat(91), false)).toBe("m");
    expect(questionSize("x".repeat(90), true)).toBe("m");
    expect(questionSize("x".repeat(200), true)).toBe("s");
  });

  test("timer counts down from locksAt, holds at 0, and is hot in the last 10 s", () => {
    expect(timerNow(timer.running(60, 42), NOW)).toMatchObject({ text: "42", hot: false, running: true });
    expect(timerNow(timer.running(60, 8), NOW)).toMatchObject({ text: "8", hot: true });
    expect(timerNow(timer.running(60, 42), NOW + 50_000)).toMatchObject({ text: "0", fraction: 0 });
    expect(timerNow(timer.running(300, 185), NOW).text).toBe("3:05");
    expect(timerNow(timer.paused(60, 30), NOW + 999_999)).toMatchObject({ text: "30", paused: true });
    expect(timerNow(timer.idle(60), NOW)).toMatchObject({ text: "1:00", started: false, hot: false });
    expect(timerNow(timer.done(), NOW).text).toBe("0");
  });

  test("the last_seconds line shows in the footer while asking", async () => {
    const view = (await loadFixtures()).get("display/asking-image") as DisplayView;
    expect(footerLine(view, "question", NOW)).toBe("Last chance… 8 seconds.");
  });
});

describe("answers locked (T-04)", () => {
  test("snaps when the lock is fresh, up to a few seconds late; shows shut after a reconnect", () => {
    expect(lockShouldSnap({ at: NOW }, NOW + 300)).toBe(true);
    expect(lockShouldSnap({ at: NOW }, NOW + 2000)).toBe(true);
    expect(lockShouldSnap({ at: NOW }, NOW + 20_000)).toBe(false);
    expect(lockShouldSnap(null, NOW)).toBe(false);
  });

  test("a question whose timer hit 0 is not \"locked\" until the server says so", async () => {
    const view = (await loadFixtures()).get("display/asking") as DisplayView;
    const atZero: DisplayView = { ...view, question: { ...view.question!, timer: timer.done() } };
    expect(screenFor(atZero, NOW)).toBe("question");
  });
});

describe("reveal (T-05)", () => {
  test("finds the right option from answerText", () => {
    const opts = ["Aretha Franklin", "Diana Ross", "Tina Turner", "Etta James"];
    expect(choiceIndex(opts, "A. Aretha Franklin")).toBe(0);
    expect(choiceIndex(opts, "C. Tina Turner")).toBe(2);
    expect(choiceIndex(opts, "Diana Ross")).toBe(1);
    expect(choiceIndex(opts, "Z. Nobody")).toBe(-1);
  });
});

describe("leaderboard (T-06)", () => {
  test("density by team count, 21-30 on their own page first", () => {
    expect(boardLayout(6)).toEqual({ density: "full", columns: 1, pages: [[0, 6]] });
    expect(boardLayout(20)).toEqual({ density: "dense", columns: 2, pages: [[0, 20]] });
    expect(boardLayout(30)).toEqual({ density: "dense", columns: 2, pages: [[20, 30], [0, 20]] });
  });

  test("bottom-up reveal: one row per step, 21-30 page, a pause, then the top 20", () => {
    expect(revealProgress(6, 0)).toEqual({ page: 0, shown: 1, done: false });
    expect(revealProgress(6, 2 * ROW_GAP_MS + 1)).toEqual({ page: 0, shown: 3, done: false });
    expect(revealProgress(6, 6 * ROW_GAP_MS)).toEqual({ page: 0, shown: 6, done: true });
    expect(revealProgress(30, 9 * ROW_GAP_MS)).toEqual({ page: 0, shown: 10, done: false });
    expect(revealProgress(30, 10 * ROW_GAP_MS + PAGE_HOLD_MS - 1)).toEqual({ page: 0, shown: 10, done: false });
    expect(revealProgress(30, 10 * ROW_GAP_MS + PAGE_HOLD_MS)).toEqual({ page: 1, shown: 1, done: false });
    expect(revealProgress(30, 10 * ROW_GAP_MS + PAGE_HOLD_MS + 20 * ROW_GAP_MS)).toEqual({ page: 1, shown: 20, done: true });
  });

  test("\"more round wins\" goes only on teams that won a points tie on round wins (S-07)", () => {
    const s = standings(6);
    const tagged = Object.keys(wonTieBreak(s.rows));
    const names = s.rows.filter((r) => tagged.includes(r.teamId)).map((r) => r.name);
    expect(names).toEqual(["The Quizzly Bears", "Universally Challenged"]);
    // A shared place (same points, same round wins) is not a tie-breaker win.
    const shared = standings(20).rows.filter((r) => r.shared).map((r) => r.teamId);
    for (const id of shared) expect(wonTieBreak(standings(20).rows)[id]).toBeUndefined();
  });

  test("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "30th"]);
  });
});

describe("footer lines and flashes (TECH-SPEC 10.4)", () => {
  test("a team_joined flash replaces the lobby line for 6 s, then the lobby line is back", async () => {
    const view = (await loadFixtures()).get("display/lobby") as DisplayView;
    expect(footerLine(view, "lobby", NOW)).toBe("Tequila Mockingbird has entered the building.");
    expect(footerLine(view, "lobby", view.flash!.at + FLASH_MS)).toBe("Grab a drink. Pick a silly name.");
  });

  test("a no_answer flash never shows on the display", async () => {
    const view = (await loadFixtures()).get("display/lobby") as DisplayView;
    const v2: DisplayView = { ...view, flash: { ...view.flash!, key: "no_answer" } };
    expect(footerLine(v2, "lobby", NOW)).toBe("Grab a drink. Pick a silly name.");
  });

  test("each screen shows its own slot", async () => {
    const f = await loadFixtures();
    expect(footerLine(f.get("display/leaderboard") as DisplayView, "leaderboard", NOW)).toBe("Quizteama Aguilera take the lead.");
    expect(footerLine(f.get("display/reveal") as DisplayView, "reveal", NOW)).toBe("Drum roll, please.");
    expect(footerLine(f.get("display/sudden_death-revealed") as DisplayView, "dl-result", NOW)).toBe("Les Quizerables break the deadlock.");
    expect(footerLine(null, "idle", NOW)).toBeNull();
  });
});

describe("after the winner (venue afterWinner)", () => {
  test("the winner shows until final.standingsAt, then the final standings", () => {
    expect(endStage(null, NOW)).toBe("winner");
    expect(endStage({ standingsAt: null }, NOW + 999_999)).toBe("winner");   // waiting for the host's Next
    expect(endStage({ standingsAt: NOW + 15_000 }, NOW + 14_999)).toBe("winner");
    expect(endStage({ standingsAt: NOW + 15_000 }, NOW + 15_000)).toBe("final");
  });
});

describe("leaderboard movement arrows", () => {
  test("up, down, same, and nothing after the first round", () => {
    expect(movement({ position: 1, prevPosition: 3 })).toEqual({ cls: "mv up", text: "\u25B22" });
    expect(movement({ position: 4, prevPosition: 3 })).toEqual({ cls: "mv down", text: "\u25BC1" });
    expect(movement({ position: 2, prevPosition: 2 })).toEqual({ cls: "mv same", text: "\u2013" });
    expect(movement({ position: 2, prevPosition: null })).toEqual({ cls: "mv", text: "" });
  });

  test("the fixtures carry a mix of moves", () => {
    const kinds = new Set(standings(10, 2).rows.map((r) => movement(r).cls));
    expect([...kinds].sort()).toEqual(["mv down", "mv same", "mv up"]);
    expect(standings(4, 0).rows.every((r) => r.prevPosition === null)).toBe(true);
  });
});

describe("venue logo, tagline and theme changes", () => {
  const doc = (logo: string, tagline: string) => ({
    querySelector: (sel: string) => ({ getAttribute: () => (sel.includes("lockin-logo") ? logo : tagline) }),
  });

  test("pageBrand reads the server's meta tags; only a theme asset path is used as the logo", () => {
    expect(pageBrand(doc("/theme/assets/logo-3f9a1c2b7d.png", "Think fast. Drink slow."))).toEqual({ logo: "/theme/assets/logo-3f9a1c2b7d.png", tagline: "Think fast. Drink slow." });
    expect(pageBrand(doc("https://evil.example/x.png", "")).logo).toBeNull();
    expect(pageBrand(doc("", "")).tagline).toBe("Lock in your answers.");
    expect(pageBrand({ querySelector: () => null })).toEqual({ logo: null, tagline: "Lock in your answers." });
  });

  test("a new themeVersion reloads at once in a calm phase, otherwise at the next phase change", () => {
    const v = (phase: string, themeVersion: string) => ({ phase, venue: { themeVersion } });
    expect(themeReloadDue("a", v("lobby", "a"), v("lobby", "a"))).toBe(false);
    expect(themeReloadDue("a", v("lobby", "b"), v("lobby", "a"))).toBe(true);
    expect(themeReloadDue("a", v("asking", "b"), v("asking", "a"))).toBe(false);
    expect(themeReloadDue("a", v("marking", "b"), v("asking", "b"))).toBe(true);
    expect(themeReloadDue(null, v("lobby", "b"), null)).toBe(false);
  });
});
