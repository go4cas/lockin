// The phone's drafts and local choices belong to one night and team (code review LI-008).
// Loads the real public/phone/state.mjs with a fake LockIn client and drives it with views.
import { plugin } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import asking from "../fixtures/views/team/asking.ts";

const ROOT = join(import.meta.dir, "../..");
plugin({
  name: "vendor-arrow",
  setup(build) {
    build.onResolve({ filter: /^\/vendor\/arrow\/index\.mjs$/ }, () => ({ path: join(ROOT, "public/vendor/arrow/index.mjs") }));
  },
});

type Pending = { name: string; args: any; resolve: (v: unknown) => void; reject: (e: unknown) => void };
let S: any;
let opts: any;
const pending: Pending[] = [];

beforeAll(async () => {
  const g = globalThis as any;
  g.location = { pathname: "/" };
  g.LockIn = {
    connect(o: unknown) {
      opts = o;
      return {
        clock: { now: () => Date.now() },
        cmd: (name: string, args: unknown) => new Promise((resolve, reject) => pending.push({ name, args, resolve, reject })),
      };
    },
  };
  S = await import("../../public/phone/state.mjs");
  S.start();
});

/** A team view for a night and team, asking one choice question with nothing sent yet. */
function view(nightId: string, teamId: string, phase = "asking"): any {
  const v = structuredClone(asking) as any;
  v.phase = phase;
  v.night = { ...v.night, id: nightId };
  v.self = { ...v.self, id: teamId, jokerAvailable: true, jokerRound: null };
  v.answers = [];
  return v;
}

describe("phone local state owner (LI-008)", () => {
  test("a new night of the same quiz starts with fresh drafts and joker offers; the same night keeps them", () => {
    const qid = asking.questions[0]!.id;
    opts.onState(view("n-1", "t-a"));
    S.ui.drafts[qid] = "2";
    S.ui.jokerSkip["3"] = true;
    S.ui.sendError[qid] = "Not sent.";
    // A reconnect within the same night and team: the unfinished draft survives.
    opts.onState(view("n-1", "t-a"));
    expect(S.ui.drafts[qid]).toBe("2");
    expect(S.ui.jokerSkip["3"]).toBe(true);
    // The night closes; the phone sits on the idle screen with no team, then joins the next night.
    const idle = { ...view("n-1", "t-a", "idle"), night: null, self: null, questions: [] };
    opts.onState(idle);
    opts.onState(view("n-2", "t-b"));
    expect(S.ui.drafts[qid]).toBeUndefined();
    expect(S.ui.jokerSkip["3"]).toBeUndefined();
    expect(S.ui.sendError[qid]).toBeUndefined();
  });

  test("rejoining as another team in the same night carries nothing over, and a late callback from the old team changes nothing", async () => {
    const q = asking.questions[0]!;
    opts.onState(view("n-3", "t-a"));
    S.ui.drafts[q.id] = "1";
    S.send(q);
    const old = pending.pop()!;
    expect(old.name).toBe("answer.submit");
    expect(S.ui.sending[q.id]).toBe(true);
    opts.onState(view("n-3", "t-c"));        // the page now belongs to another team
    expect(S.ui.drafts[q.id]).toBeUndefined();
    expect(S.ui.sending[q.id]).toBeUndefined();
    S.ui.drafts[q.id] = "3";
    S.send(q);
    old.reject({ code: "disconnected", message: "Not connected." });
    await Bun.sleep(0);
    expect(S.ui.sendError[q.id] ?? "").toBe("");      // the old team's failure is not shown to the new team
    expect(S.ui.sending[q.id]).toBe(true);            // the new team's send is still on its way
    pending.pop()!.resolve({ receivedAt: 1 });
    await Bun.sleep(0);
    expect(S.ui.sending[q.id]).toBe(false);
  });
});
