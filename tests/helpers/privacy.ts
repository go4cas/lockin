// Privacy rules for the display and team views (TECH-SPEC 10.3, 12.3), checked on
// every view a test receives (B9). The display view never carries answers, marks
// before reveal, or anything a team should not see; a team view carries only
// that team's own answers.
//
//   const watch = new PrivacyWatch();
//   watch.secret("Abbey Road", qid);        // a correct answer: public only while that question is revealed
//   watch.secret("host note text");         // never public
//   watch.guess(teamId, "my guess");        // a team's typed answer: only in that team's own `answers`
//   ...play the night...
//   const report = watch.check(clients);    // { checked, problems }

import type { DisplayView, ServerMsg, TeamView } from "../../src/shared/protocol.ts";

/** Keys that only the host view may carry. */
const HOST_ONLY_KEYS = new Set([
  "answer", "note", "accepted", "correct", "groups", "noAnswer", "pending", "pendingTotal",
  "marking", "questionHost", "suddenDeathNeeded", "can", "token", "tokenHash", "connected", "lastSeenAt",
  "answeredCurrent", "mark", "markedBy", "finalStandingsAt",
]);

/**
 * Phases in which the room may see standings (every mark is public by then). The engine
 * sends them in leaderboard, halftime and ended (10.3); sudden_death comes after the last
 * leaderboard, so standings there would leak nothing (the B0 display fixture has them).
 */
const STANDINGS_PHASES = new Set(["leaderboard", "halftime", "sudden_death", "ended"]);

interface Seen { role: "display" | "team"; selfId: string | null; view: DisplayView | TeamView; where: string }

export interface PrivacyReport { checked: { display: number; team: number }; problems: string[] }

export class PrivacyWatch {
  private secrets: { text: string; questionId: string | null }[] = [];
  private guesses: { teamId: string; text: string }[] = [];

  /** A string that is public only while `questionId` is the revealed question (or never, with null). */
  secret(text: string, questionId: string | null = null): void {
    this.secrets.push({ text: text.toLowerCase(), questionId });
  }

  /** A team's typed answer text. */
  guess(teamId: string, text: string): void {
    this.guesses.push({ teamId, text: JSON.stringify(text) });
  }

  /** Checks every display and team `state` message the clients received. */
  check(clients: { role: "host" | "display" | "team"; received: ServerMsg[]; label?: string }[]): PrivacyReport {
    const problems: string[] = [];
    const checked = { display: 0, team: 0 };
    for (const c of clients) {
      if (c.role === "host") continue;
      let selfId: string | null = null;
      for (const msg of c.received) {
        if (msg.t === "welcome") selfId = msg.teamId;
        if (msg.t !== "state") continue;
        const view = msg.view as DisplayView | TeamView;
        if (c.role === "team" && (view as TeamView).self) selfId = (view as TeamView).self!.id;
        checked[c.role]++;
        problems.push(...this.checkOne({ role: c.role, selfId, view, where: `${c.label ?? c.role} seq ${msg.seq} (${view.phase})` }));
      }
    }
    return { checked, problems: [...new Set(problems)] };
  }

  checkOne({ role, selfId, view, where }: Seen): string[] {
    const out: string[] = [];
    if (view.role !== role) out.push(`${where}: a ${role} connection got a ${view.role} view`);

    // 1. No host-only keys anywhere, at any depth.
    walk(view, [], (path, key) => {
      if (HOST_ONLY_KEYS.has(key)) out.push(`${where}: host-only key "${path.concat(key).join(".")}"`);
      if (key === "rejoinCode" && !(role === "team" && path.join(".") === "self")) out.push(`${where}: rejoinCode at ${path.concat(key).join(".")}`);
      if (key === "answerText" && path.join(".") !== "reveal") out.push(`${where}: answerText at ${path.concat(key).join(".")}`);
      if (key === "answers" && !(role === "team" && path.length === 0)) out.push(`${where}: answers at ${path.concat(key).join(".")}`);
    });

    // 2. Marks and standings only once the room may see them.
    if ((view as DisplayView).standings && !STANDINGS_PHASES.has(view.phase)) out.push(`${where}: standings shown in ${view.phase}`);
    if ((view as DisplayView).reveal && view.phase !== "reveal") out.push(`${where}: reveal item in ${view.phase}`);
    const sd = (view as DisplayView).suddenDeath;
    if (sd && sd.rightIds !== null && sd.status !== "revealed") out.push(`${where}: sudden-death rightIds before reveal`);
    if ((view as DisplayView).final && view.phase !== "ended") out.push(`${where}: final in ${view.phase}`);

    // 3. Flashes: a no_answer flash only for the team concerned.
    if (view.flash?.key === "no_answer" && (role !== "team" || view.flash.teamId !== selfId)) out.push(`${where}: someone else's no_answer flash`);

    // 4. Team views: only this team's answers, for questions in the view.
    let rest: unknown = view;
    if (role === "team") {
      const tv = view as TeamView;
      if (tv.self && selfId && tv.self.id !== selfId) out.push(`${where}: self is ${tv.self.id}, bound to ${selfId}`);
      const shownIds = new Set([...tv.questions.map((q) => q.id), ...(tv.suddenDeath?.question ? [tv.suddenDeath.question.id] : [])]);
      for (const a of tv.answers) {
        if (!shownIds.has(a.questionId)) out.push(`${where}: answer for ${a.questionId}, which is not in the view`);
        if (a.value.type === "text" && !this.guesses.some((g) => g.teamId === selfId && g.text === JSON.stringify(a.value.type === "text" ? a.value.text : ""))) {
          out.push(`${where}: answer text ${JSON.stringify(a.value.text)} is not one this team sent`);
        }
      }
      if (!tv.self && tv.answers.length) out.push(`${where}: answers on an unbound connection`);
      rest = { ...tv, answers: [] };   // own answers checked above; search the rest
    }

    // 5. No other team's typed answers; correct answers only while that question is revealed.
    const json = JSON.stringify(rest);
    const lower = json.toLowerCase();
    const revealed = view.phase === "reveal" ? (view as DisplayView).reveal?.question.id ?? null : null;
    const public_ = new Set(this.secrets.filter((s) => s.questionId !== null && s.questionId === revealed).map((s) => JSON.stringify(s.text)));
    for (const g of this.guesses) {
      if (public_.has(g.text.toLowerCase())) continue;   // a right guess is the answer being revealed
      if (json.includes(g.text)) out.push(`${where}: a team's typed answer ${g.text} is visible`);
    }
    for (const s of this.secrets) {
      if (s.questionId !== null && s.questionId === revealed) continue;
      if (lower.includes(s.text)) out.push(`${where}: "${s.text}" visible${s.questionId ? ` before ${s.questionId} is revealed` : ""}`);
    }
    return out;
  }
}

function walk(v: unknown, path: string[], fn: (path: string[], key: string) => void): void {
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path.concat(`[${i}]`), fn)); return; }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      fn(path, k);
      walk(x, path.concat(k), fn);
    }
  }
}
