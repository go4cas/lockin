import { describe, expect, test } from "bun:test";
import {
  DEFAULT_QUIZ_SETTINGS, HOLDING_PANELS, defaultTheme, defaultVenue, validDatetime, validateQuiz, validateTheme, validateVenue,
  type QuizFile,
} from "../../src/shared/formats.ts";

function quiz(): QuizFile {
  return {
    format: "lockin.quiz/1",
    id: "friday-classics",
    title: "Friday classics",
    updatedAt: "2026-11-20T18:00:00.000Z",
    settings: { ...DEFAULT_QUIZ_SETTINGS },
    rounds: [
      {
        id: "r-aaaa0001", title: "General knowledge",
        questions: [
          { id: "q-aaaa0001", text: "Who was the 35th US president?", note: "Accept JFK", answer: { type: "text", accepted: ["John F Kennedy", "JFK"] } },
          { id: "q-aaaa0002", text: "Capital of France?", answer: { type: "choice", options: ["Berlin", "Paris", "Rome"], correct: 1 } },
          { id: "q-aaaa0003", text: "How many sides on a hexagon?", timerSeconds: 30, answer: { type: "number", value: 6 } },
          { id: "q-aaaa0004", text: "Height of Everest in metres?", answer: { type: "closest", value: 8849, range: 100 } },
          { id: "q-aaaa0005", text: "Moon landing date?", answer: { type: "datetime", precision: "date", value: "1969-07-20", scoring: "exact" } },
          { id: "q-aaaa0006", text: "Whose face is this?", media: { kind: "image", file: "q-aaaa0006-9f3a.jpg", alt: "A face" }, answer: { type: "text", accepted: ["Ada Lovelace"] } },
        ],
      },
      {
        id: "r-aaaa0002", title: "",
        questions: [{ id: "q-aaaa0007", text: "Year of the first FA Cup final?", answer: { type: "datetime", precision: "year", value: "1872", scoring: "closest", range: 2 } }],
      },
    ],
    suddenDeath: [{ id: "q-sd000001", text: "How many pints in a gallon?", answer: { type: "closest", value: 8 } }],
  };
}

const messages = (r: { ok: boolean; problems?: { message: string }[] }) => (r.ok ? [] : r.problems!.map((p) => p.message));

describe("validateQuiz", () => {
  test("accepts a valid quiz with every answer type", () => {
    const r = validateQuiz(quiz(), { folderId: "friday-classics", mediaExists: () => true });
    expect(messages(r)).toEqual([]);
    expect(r.ok && r.quiz.rounds[0]!.questions.length).toBe(6);
  });

  test("fills missing settings with their defaults", () => {
    const q = quiz() as unknown as Record<string, unknown>;
    delete q.settings;
    const r = validateQuiz(q);
    expect(r.ok && r.quiz.settings).toEqual(DEFAULT_QUIZ_SETTINGS);
    const partial = { ...quiz(), settings: { joker: true } };
    const r2 = validateQuiz(partial);
    expect(r2.ok && r2.quiz.settings).toEqual({ ...DEFAULT_QUIZ_SETTINGS, joker: true });
  });

  test("defaults are the spec's", () => {
    expect(DEFAULT_QUIZ_SETTINGS).toEqual({
      lockMode: "question", timerSeconds: 60, halftimeAfterRound: "auto", joker: false,
      maxTeams: 30, suddenDeathScope: "first", suddenDeathMax: 3, closestScoring: "closest",
    });
  });

  test("reports a question with no answer in plain English", () => {
    const q = quiz();
    (q.rounds[1]!.questions[0] as unknown as Record<string, unknown>).answer = undefined;
    q.rounds[0]!.questions[3]!.answer = { type: "text", accepted: [] };
    const r = validateQuiz(q);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain("Round 2, question 1 has no answer.");
    expect(messages(r)).toContain("Round 1, question 4 has no answer.");
    expect(!r.ok && r.problems.find((p) => p.message.startsWith("Round 2"))!.path).toBe("rounds.1.questions.0.answer");
  });

  test("reports empty text, empty rounds and no rounds", () => {
    const q = quiz();
    q.rounds[0]!.questions[1]!.text = "  ";
    q.rounds[1]!.questions = [];
    expect(messages(validateQuiz(q))).toEqual(expect.arrayContaining([
      "Round 1, question 2 has no question text.",
      "Round 2 has no questions.",
    ]));
    expect(messages(validateQuiz({ ...quiz(), rounds: [] }))).toContain("The quiz has no rounds.");
  });

  test("names an unknown answer type or media kind instead of crashing (forward compatibility)", () => {
    const q = quiz() as unknown as { rounds: { questions: Record<string, unknown>[] }[] };
    q.rounds[0]!.questions[0]!.answer = { type: "ranking", order: [] };
    q.rounds[0]!.questions[1]!.media = { kind: "audio", file: "a.mp3" };
    const m = messages(validateQuiz(q));
    expect(m).toContain('Round 1, question 1 uses answer type "ranking", which this version of Lock-In cannot mark.');
    expect(m).toContain('Round 1, question 2 uses media of kind "audio", which this version of Lock-In cannot show.');
  });

  test("checks the format line, id, title and folder", () => {
    expect(messages(validateQuiz({ ...quiz(), format: "lockin.quiz/2" }))[0]).toContain('"lockin.quiz/2"');
    expect(messages(validateQuiz({ ...quiz(), id: "Bad Id" }))[0]).toContain("quiz id");
    expect(messages(validateQuiz({ ...quiz(), title: "" }))).toContain("The quiz has no title.");
    expect(messages(validateQuiz({ ...quiz(), title: "x".repeat(81) }))).toContain("The quiz title is longer than 80 characters.");
    expect(messages(validateQuiz(quiz(), { folderId: "other" }))[0]).toContain('does not match its folder "other"');
    expect(messages(validateQuiz("nope"))).toEqual(["The quiz file is not a JSON object."]);
  });

  test("checks settings ranges", () => {
    const bad = { ...quiz(), settings: { lockMode: "team", timerSeconds: 5, halftimeAfterRound: 0, joker: "yes", maxTeams: 31, suddenDeathScope: "some", suddenDeathMax: 11, closestScoring: "near" } };
    const r = validateQuiz(bad);
    expect(!r.ok && r.problems.map((p) => p.path).sort()).toEqual([
      "settings.closestScoring", "settings.halftimeAfterRound", "settings.joker", "settings.lockMode",
      "settings.maxTeams", "settings.suddenDeathMax", "settings.suddenDeathScope", "settings.timerSeconds",
    ]);
    expect(messages(validateQuiz({ ...quiz(), settings: { halftimeAfterRound: 3 } }))).toContain("Halftime is set after round 3, but the quiz has only 2 rounds.");
  });

  test("checks ids are well formed and unique", () => {
    const q = quiz();
    q.rounds[0]!.questions[1]!.id = "q-aaaa0001";
    q.rounds[1]!.id = "round2";
    const m = messages(validateQuiz(q));
    expect(m).toContain("Round 1, question 2 has the same id as another question.");
    expect(m).toContain("Round 2 has a missing or malformed id.");
  });

  test("checks answer details", () => {
    const q = quiz();
    q.rounds[0]!.questions[1]!.answer = { type: "choice", options: ["Only one"], correct: 0 };
    q.rounds[0]!.questions[2]!.answer = { type: "choice", options: ["A", "B"], correct: 2 };
    q.rounds[0]!.questions[3]!.answer = { type: "closest", value: 10, range: -1 };
    q.rounds[0]!.questions[4]!.answer = { type: "datetime", precision: "date", value: "1969-02-30", scoring: "exact" };
    const m = messages(validateQuiz(q));
    expect(m).toContain("Round 1, question 2 needs 2 to 6 options.");
    expect(m).toContain("Round 1, question 3 has no correct option picked.");
    expect(m).toContain("Round 1, question 4's range must be a number of 0 or more.");
    expect(m).toContain("Round 1, question 5's answer must be a date like 1969-07-20.");
  });

  test("sudden death allows only text, choice and closest", () => {
    const q = quiz();
    q.suddenDeath[0]!.answer = { type: "number", value: 8 };
    expect(messages(validateQuiz(q))).toContain("Sudden-death question 1 must be a typed answer, multiple choice or closest number.");
  });

  test("a missing image makes the quiz not ready; unsafe file names are refused", () => {
    expect(messages(validateQuiz(quiz(), { mediaExists: () => false }))).toContain('Round 1, question 6\'s image "q-aaaa0006-9f3a.jpg" is missing from the quiz\'s media folder.');
    const q = quiz();
    q.rounds[0]!.questions[5]!.media = { kind: "image", file: "../../etc/passwd" };
    expect(messages(validateQuiz(q))).toContain("Round 1, question 6's image file name is missing or not allowed.");
  });

  test("validDatetime by precision", () => {
    expect(validDatetime("year", "1969")).toBe(true);
    expect(validDatetime("year", "69a")).toBe(false);
    expect(validDatetime("date", "2024-02-29")).toBe(true);
    expect(validDatetime("date", "2023-02-29")).toBe(false);
    expect(validDatetime("time", "20:17")).toBe(true);
    expect(validDatetime("time", "24:00")).toBe(false);
  });
});

describe("validateTheme", () => {
  test("an empty theme means every default", () => {
    const r = validateTheme({ format: "lockin.theme/1" });
    expect(r.ok && r.value).toEqual(defaultTheme());
  });

  test("accepts a full theme", () => {
    const theme = {
      format: "lockin.theme/1",
      name: "The Example Arms",
      logo: "assets/logo-1a2b.svg",
      colours: { background: "#101820", text: "#F2F2F2", accent: "#ff7a5c", accent2: null },
      fonts: { display: { bundled: "bebas-neue" }, body: { file: "assets/body-9c.woff2" } },
      displayBackground: { image: "assets/display-1.webp" },
      copy: { winner: { mode: "add", lines: ["{team} take the crown at {pub}!"] } },
    };
    const r = validateTheme(theme);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.colours.text).toBe("#f2f2f2");
    expect(r.ok && r.value.copy.winner!.lines).toHaveLength(1);
  });

  test("reports bad fields in plain English", () => {
    const r = validateTheme({
      format: "lockin.theme/1",
      name: "",
      logo: "../logo.png",
      colours: { accent: "red" },
      fonts: { display: { bundled: "comic-sans" }, body: { file: "assets/x.otf" } },
      displayBackground: { colour: "#12345" },
      copy: { winner: { mode: "swap", lines: [] }, "Bad Key": { mode: "add", lines: ["x"] } },
    });
    expect(messages(r).sort()).toEqual([
      '"Bad Key" is not a copy pool name.',
      'The "winner" lines must say whether they replace or add to the default lines.',
      'The display font "comic-sans" is not one of Lock-In\'s bundled fonts.',
      "The display background colour must be a colour code like #1a2b3c.",
      "The body font file must be a WOFF2, WOFF or TTF file in the theme's assets folder.",
      "The logo must be a PNG, SVG or JPEG file in the theme's assets folder.",
      "The main colour must be a colour code like #1a2b3c.",
      "The venue name must be 1 to 60 characters.",
    ].sort());
  });

  test("the body font must be Atkinson Hyperlegible or an upload (Design's branding.md)", () => {
    const r = validateTheme({ format: "lockin.theme/1", fonts: { display: { bundled: "atkinson-hyperlegible" }, body: { bundled: "bebas-neue" } } });
    expect(messages(r)).toEqual(['"bebas-neue" is a headline font. The body font must be Atkinson Hyperlegible or an uploaded font.']);
    expect(validateTheme({ format: "lockin.theme/1", fonts: { body: { bundled: "atkinson-hyperlegible" } } }).ok).toBe(true);
  });

  test("rejects a wrong format or non-object", () => {
    expect(validateTheme({ format: "other" }).ok).toBe(false);
    expect(validateTheme([]).ok).toBe(false);
  });
});

describe("validateVenue", () => {
  test("an empty venue file means every default", () => {
    const r = validateVenue({ format: "lockin.venue/1" });
    expect(r.ok && r.value).toEqual(defaultVenue());
    expect(defaultVenue().holding).toEqual({ minutesBefore: 30, panels: [...HOLDING_PANELS] });
  });

  test("accepts prizes and panels; unknown and repeated panels are dropped", () => {
    const r = validateVenue({
      format: "lockin.venue/1",
      prizes: [{ place: 1, text: "A round of drinks" }, { place: 2, text: "Bar snacks" }],
      holding: { minutesBefore: 45, panels: ["join", "laser-show", "countdown", "join"] },
    });
    expect(r.ok && r.value.prizes).toHaveLength(2);
    expect(r.ok && r.value.holding).toEqual({ minutesBefore: 45, panels: ["join", "countdown"] });
  });

  test("reports bad prizes and minutes", () => {
    const r = validateVenue({ format: "lockin.venue/1", prizes: [{ place: 0, text: "x" }, { place: 2, text: "" }], holding: { minutesBefore: 500 } });
    expect(messages(r)).toEqual([
      "Prize 1 needs a place of 1 or more.",
      "The prize for place 2 must be 1 to 80 characters.",
      "The holding page must start 0 to 120 minutes before the quiz.",
    ]);
  });
});
