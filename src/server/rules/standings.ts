// Scoring, positions, tie breaker and sudden death (TECH-SPEC 8.3 to 8.5),
// and the leaderboard line choice (5.5). Pure functions: no I/O, no engine state.

import type { ScoreInput, ScoreResult, StandingRow, SuddenDeathOutcome } from "../../shared/rules-api.ts";

/**
 * 8.3: 1 point per correct answer, a team's joker round (0-based) counts
 * double, total is the sum. A round win goes to every team on the top score
 * of the round, joker included, if that score is above 0.
 * Teams come back in the order given.
 */
export function score(input: ScoreInput): ScoreResult {
  const teams = input.teams.map((t) => {
    const roundScores = input.rounds.map((r, i) => {
      let n = 0;
      for (const q of r.questionIds) if (input.correct.has(`${t.id}:${q}`)) n++;
      return t.jokerRound === i ? n * 2 : n;
    });
    return { id: t.id, roundScores, total: roundScores.reduce((a, b) => a + b, 0), roundWins: 0 };
  });
  input.rounds.forEach((_, i) => {
    const top = Math.max(0, ...teams.map((t) => t.roundScores[i]!));
    if (top <= 0) return;
    for (const t of teams) if (t.roundScores[i] === top) t.roundWins++;
  });
  return { teams };
}

type Team = ScoreResult["teams"][number];

/**
 * 8.4: sort by total, then round wins (the tie breaker); teams still level
 * share a position unless a sudden-death outcome for that position orders
 * them. Positions use competition ranking (1, 2, 2, 4).
 *
 * An outcome applies to a group of level teams at its position only when every
 * team in the group took part in it; if marks changed after sudden death and
 * different teams are now level there, the outcome is ignored.
 */
export function rank(result: ScoreResult, sd: SuddenDeathOutcome[]): StandingRow[] {
  const order = result.teams.map((t, i) => ({ t, i }));
  order.sort((a, b) => b.t.total - a.t.total || b.t.roundWins - a.t.roundWins || a.i - b.i);
  const sorted = order.map((o) => o.t);

  const rows: StandingRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    // Teams level on points.
    let j = i;
    while (j < sorted.length && sorted[j]!.total === sorted[i]!.total) j++;
    const levelOnPoints = j - i > 1;
    let k = i;
    while (k < j) {
      // Teams level on points and round wins.
      let l = k;
      while (l < j && sorted[l]!.roundWins === sorted[k]!.roundWins) l++;
      const group = sorted.slice(k, l);
      const position = k + 1;
      if (group.length === 1) {
        rows.push(row(group[0]!, position, false, levelOnPoints ? "tie_breaker" : "points"));
      } else {
        rows.push(...settle(group, position, sd, new Set()));
      }
      k = l;
    }
    i = j;
  }
  return rows;
}

function row(t: Team, position: number, shared: boolean, decidedBy: StandingRow["decidedBy"]): StandingRow {
  return { teamId: t.id, position, shared, total: t.total, roundScores: [...t.roundScores], roundWins: t.roundWins, decidedBy };
}

/** Teams level after the tie breaker at `position`: apply a sudden-death outcome if there is one. */
function settle(group: Team[], position: number, sd: SuddenDeathOutcome[], used: Set<SuddenDeathOutcome>): StandingRow[] {
  const outcome = findOutcome(group.map((t) => t.id), position, sd, used);
  if (!outcome) return group.map((t) => row(t, position, true, "shared"));
  const nextUsed = new Set(used).add(outcome);
  const byId = new Map(group.map((t) => [t.id, t]));
  const rows: StandingRow[] = [];
  let pos = position;
  for (const ids of outcome.order) {
    const teams = ids.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    if (teams.length === 0) continue;
    if (teams.length === 1) rows.push(row(teams[0]!, pos, false, "sudden_death"));
    else rows.push(...settle(teams, pos, sd, nextUsed));
    pos += teams.length;
  }
  return rows;
}

function findOutcome(ids: string[], position: number, sd: SuddenDeathOutcome[], used: Set<SuddenDeathOutcome>): SuddenDeathOutcome | null {
  for (const o of sd) {
    if (o.position !== position || used.has(o)) continue;
    const inIt = new Set(o.order.flat());
    if (ids.every((id) => inIt.has(id))) return o;
  }
  return null;
}

/**
 * 8.5: the best (lowest) shared position the scope covers (`first`: position 1
 * only; `all`: any) that has no sudden-death outcome yet, with its teams in
 * standings order; null when none is needed.
 */
export function suddenDeathNeeded(
  rows: StandingRow[],
  scope: "first" | "all",
  done: SuddenDeathOutcome[],
): { position: number; teamIds: string[] } | null {
  const shared = new Map<number, string[]>();
  for (const r of rows) {
    if (!r.shared) continue;
    const list = shared.get(r.position) ?? [];
    list.push(r.teamId);
    shared.set(r.position, list);
  }
  const positions = [...shared.keys()].sort((a, b) => a - b);
  for (const position of positions) {
    if (scope === "first" && position !== 1) continue;
    const teamIds = shared.get(position)!;
    if (teamIds.length < 2) continue;
    if (findOutcome(teamIds, position, done, new Set())) continue;
    return { position, teamIds };
  }
  return null;
}

/**
 * 8.5, after one sudden-death question is revealed:
 * - exactly one right: it is the winner; the rest stay tied for the next position;
 * - more than one right (not all): no winner; the right ones go on, the wrong ones drop out;
 * - none or all right: no winner; everyone stays in.
 * `rightIds` outside `teamIds` are ignored. Order follows `teamIds`.
 */
export function resolveSuddenDeath(teamIds: string[], rightIds: string[]): { winner: string | null; remaining: string[] } {
  const right = new Set(rightIds);
  const rightIn = teamIds.filter((id) => right.has(id));
  if (rightIn.length === 1) {
    const winner = rightIn[0]!;
    return { winner, remaining: teamIds.filter((id) => id !== winner) };
  }
  if (rightIn.length === 0 || rightIn.length === teamIds.length) return { winner: null, remaining: [...teamIds] };
  return { winner: null, remaining: rightIn };
}

/**
 * 5.5: at most one line per leaderboard, in priority order:
 * - `tie_breaker`: the tie breaker decided 1st place;
 * - `lead_change`: a team is in 1st place that was not in 1st on the previous leaderboard;
 * - `close_race`: the top two are within 1 point (and the leader has scored);
 * - `big_climb`: a team rose 3 or more places since the previous leaderboard.
 * `before` is null for the first leaderboard of the night.
 */
export function leaderboardLine(
  before: StandingRow[] | null,
  after: StandingRow[],
): "tie_breaker" | "lead_change" | "close_race" | "big_climb" | null {
  if (after.some((r) => r.position === 1 && r.decidedBy === "tie_breaker")) return "tie_breaker";

  if (before) {
    const leadersBefore = new Set(before.filter((r) => r.position === 1).map((r) => r.teamId));
    if (after.some((r) => r.position === 1 && !leadersBefore.has(r.teamId))) return "lead_change";
  }

  const byTotal = [...after].sort((a, b) => a.position - b.position);
  if (byTotal.length >= 2 && byTotal[0]!.total > 0 && byTotal[0]!.total - byTotal[1]!.total <= 1) return "close_race";

  if (before) {
    const was = new Map(before.map((r) => [r.teamId, r.position]));
    if (after.some((r) => { const p = was.get(r.teamId); return p !== undefined && p - r.position >= 3; })) return "big_climb";
  }
  return null;
}
