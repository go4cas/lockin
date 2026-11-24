// Persistence for the night (TECH-SPEC 6.2, 6.3): the in-memory model of the
// open night and how it is written to and read from SQLite.

import type { Database } from "bun:sqlite";
import type { Prize, QuizFile } from "../../shared/formats.ts";
import type { AnswerValue, Mark, StandingRow } from "../../shared/rules-api.ts";
import type { EngineState } from "./state.ts";

export interface NightRec {
  id: string;
  quizId: string;
  quizTitle: string;
  quiz: QuizFile;                  // the snapshot
  roomCode: string;
  status: "open" | "ended";
  openedAt: number;
  plannedStart: number | null;
  startedAt: number | null;
  endedAt: number | null;
  endReason: "finished" | "early" | null;
  prizes: Prize[];
}

export interface TeamRec {
  id: string;
  name: string;
  nameKey: string;
  colour: number;
  tokenHash: string | null;
  rejoinCode: string;
  jokerRound: number | null;
  joinedAt: number;
  removedAt: number | null;
}

export interface AnswerRec {
  teamId: string;
  questionId: string;
  value: AnswerValue | null;
  receivedAt: number | null;
  changes: number;
  mark: Mark;
  markedBy: "auto" | "host" | null;
  markedAt: number | null;
}

export interface SdRow {
  seq: number;
  position: number;
  teamIds: string[];
  questionId: string;
  rightIds: string[] | null;
}

export interface MarkChange { teamId: string; questionId: string; from: Mark; to: Mark; at: number }

export interface Model {
  night: NightRec;
  teams: Map<string, TeamRec>;
  answers: Map<string, AnswerRec>;   // key `${teamId}:${questionId}`
  sd: SdRow[];
  state: EngineState;
}

export const answerKey = (teamId: string, questionId: string) => `${teamId}:${questionId}`;

/** What changed during one command, written in one transaction (6.3). */
export class Dirty {
  nightNew = false;
  night = false;
  teams = new Set<string>();
  answers = new Set<string>();
  sd = new Set<number>();
  markChanges: MarkChange[] = [];
  results: StandingRow[] | null = null;
  clear(): void {
    this.nightNew = false; this.night = false; this.teams.clear(); this.answers.clear(); this.sd.clear();
    this.markChanges = []; this.results = null;
  }
}

const j = JSON.stringify;

/** Writes everything marked dirty plus the state row, in one transaction. */
export function flush(db: Database, m: Model, d: Dirty): void {
  db.transaction(() => {
    const n = m.night;
    if (d.nightNew) {
      db.query(`INSERT INTO nights (id, quiz_id, quiz_title, quiz_snapshot, room_code, status, opened_at, planned_start,
                  started_at, ended_at, end_reason, prizes, state)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(n.id, n.quizId, n.quizTitle, j(n.quiz), n.roomCode, n.status, n.openedAt, n.plannedStart,
             n.startedAt, n.endedAt, n.endReason, j(n.prizes), j(m.state));
    } else {
      if (d.night) {
        db.query(`UPDATE nights SET quiz_snapshot = ?, room_code = ?, status = ?, planned_start = ?, started_at = ?, ended_at = ?,
                    end_reason = ?, prizes = ? WHERE id = ?`)
          .run(j(n.quiz), n.roomCode, n.status, n.plannedStart, n.startedAt, n.endedAt, n.endReason, j(n.prizes), n.id);
      }
      db.query("UPDATE nights SET state = ? WHERE id = ?").run(j(m.state), n.id);
    }
    for (const id of d.teams) {
      const t = m.teams.get(id);
      if (!t) continue;
      db.query(`INSERT INTO teams (id, night_id, name, name_key, colour, token_hash, rejoin_code, joker_round, joined_at, removed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key, colour = excluded.colour,
                  token_hash = excluded.token_hash, rejoin_code = excluded.rejoin_code, joker_round = excluded.joker_round,
                  removed_at = excluded.removed_at`)
        .run(t.id, n.id, t.name, t.nameKey, t.colour, t.tokenHash, t.rejoinCode, t.jokerRound, t.joinedAt, t.removedAt);
    }
    for (const key of d.answers) {
      const a = m.answers.get(key);
      if (!a) continue;
      db.query(`INSERT INTO answers (night_id, team_id, question_id, value, received_at, changes, mark, marked_by, marked_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(night_id, team_id, question_id) DO UPDATE SET value = excluded.value, received_at = excluded.received_at,
                  changes = excluded.changes, mark = excluded.mark, marked_by = excluded.marked_by, marked_at = excluded.marked_at`)
        .run(n.id, a.teamId, a.questionId, a.value === null ? null : j(a.value), a.receivedAt, a.changes, a.mark, a.markedBy, a.markedAt);
    }
    for (const seq of d.sd) {
      const r = m.sd.find((x) => x.seq === seq);
      if (!r) continue;
      db.query(`INSERT INTO sudden_deaths (night_id, seq, position, team_ids, question_id, right_ids) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(night_id, seq) DO UPDATE SET right_ids = excluded.right_ids`)
        .run(n.id, r.seq, r.position, j(r.teamIds), r.questionId, r.rightIds === null ? null : j(r.rightIds));
    }
    for (const c of d.markChanges) {
      db.query("INSERT INTO mark_changes (night_id, team_id, question_id, from_mark, to_mark, at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(n.id, c.teamId, c.questionId, c.from, c.to, c.at);
    }
    if (d.results) {
      db.query("DELETE FROM results WHERE night_id = ?").run(n.id);
      for (const r of d.results) {
        db.query(`INSERT INTO results (night_id, team_id, position, shared, total, round_scores, round_wins, decided_by)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(n.id, r.teamId, r.position, r.shared ? 1 : 0, r.total, j(r.roundScores), r.roundWins, r.decidedBy);
      }
    }
  })();
}

interface NightRow {
  id: string; quiz_id: string; quiz_title: string; quiz_snapshot: string; room_code: string; status: "open" | "ended";
  opened_at: number; planned_start: number | null; started_at: number | null; ended_at: number | null;
  end_reason: "finished" | "early" | null; prizes: string; state: string;
}
interface TeamRow {
  id: string; name: string; name_key: string; colour: number; token_hash: string | null; rejoin_code: string;
  joker_round: number | null; joined_at: number; removed_at: number | null;
}
interface AnswerRow {
  team_id: string; question_id: string; value: string | null; received_at: number | null; changes: number;
  mark: Mark; marked_by: "auto" | "host" | null; marked_at: number | null;
}
interface SdDbRow { seq: number; position: number; team_ids: string; question_id: string; right_ids: string | null }

export function nightFromRow(r: NightRow): NightRec {
  return {
    id: r.id, quizId: r.quiz_id, quizTitle: r.quiz_title, quiz: JSON.parse(r.quiz_snapshot), roomCode: r.room_code,
    status: r.status, openedAt: r.opened_at, plannedStart: r.planned_start, startedAt: r.started_at, endedAt: r.ended_at,
    endReason: r.end_reason, prizes: JSON.parse(r.prizes),
  };
}

export function loadTeams(db: Database, nightId: string): TeamRec[] {
  return db.query<TeamRow, [string]>("SELECT * FROM teams WHERE night_id = ? ORDER BY joined_at, rowid").all(nightId).map((t) => ({
    id: t.id, name: t.name, nameKey: t.name_key, colour: t.colour, tokenHash: t.token_hash, rejoinCode: t.rejoin_code,
    jokerRound: t.joker_round, joinedAt: t.joined_at, removedAt: t.removed_at,
  }));
}

export function loadAnswers(db: Database, nightId: string): AnswerRec[] {
  return db.query<AnswerRow, [string]>("SELECT * FROM answers WHERE night_id = ?").all(nightId).map((a) => ({
    teamId: a.team_id, questionId: a.question_id, value: a.value === null ? null : JSON.parse(a.value), receivedAt: a.received_at,
    changes: a.changes, mark: a.mark, markedBy: a.marked_by, markedAt: a.marked_at,
  }));
}

/** Loads the open night, if any, with its teams, answers and sudden-death rows (7.6). */
export function loadOpenNight(db: Database): Model | null {
  const row = db.query<NightRow, []>("SELECT * FROM nights WHERE status = 'open'").get();
  if (!row) return null;
  const sd = db.query<SdDbRow, [string]>("SELECT * FROM sudden_deaths WHERE night_id = ? ORDER BY seq").all(row.id).map((r) => ({
    seq: r.seq, position: r.position, teamIds: JSON.parse(r.team_ids), questionId: r.question_id,
    rightIds: r.right_ids === null ? null : JSON.parse(r.right_ids),
  }));
  return {
    night: nightFromRow(row),
    teams: new Map(loadTeams(db, row.id).map((t) => [t.id, t])),
    answers: new Map(loadAnswers(db, row.id).map((a) => [answerKey(a.teamId, a.questionId), a])),
    sd,
    state: JSON.parse(row.state),
  };
}

// --- History (S-08) ----------------------------------------------------------

/** Nights the history list answers with, newest first (audit SA-21): years of weekly nights. */
export const HISTORY_LIMIT = 500;

/** The history list in one query (SA-21: it ran two queries per night). */
export function historyList(db: Database) {
  const rows = db.query<NightRow & { team_count: number; winner_names: string }, [number]>(`
    SELECT n.*,
      (SELECT COUNT(*) FROM teams t WHERE t.night_id = n.id AND t.removed_at IS NULL) AS team_count,
      (SELECT json_group_array(name) FROM (
        SELECT t.name AS name FROM results r JOIN teams t ON t.id = r.team_id
        WHERE r.night_id = n.id AND r.position = 1 ORDER BY t.name)) AS winner_names
    FROM nights n ORDER BY n.opened_at DESC LIMIT ?`).all(HISTORY_LIMIT);
  return rows.map((r) => ({
    id: r.id, quizTitle: r.quiz_title, openedAt: r.opened_at, endedAt: r.ended_at,
    teams: r.team_count, winners: JSON.parse(r.winner_names) as string[],
  }));
}

export function historyNight(db: Database, nightId: string) {
  const row = db.query<NightRow, [string]>("SELECT * FROM nights WHERE id = ?").get(nightId);
  if (!row) return null;
  const night = nightFromRow(row);
  const teams = loadTeams(db, nightId);
  const names = new Map(teams.map((t) => [t.id, t.name]));
  const results = db.query<{ team_id: string; position: number; shared: number; total: number; round_scores: string; round_wins: number; decided_by: StandingRow["decidedBy"] }, [string]>(
    "SELECT * FROM results WHERE night_id = ? ORDER BY position, team_id",
  ).all(nightId);
  const standings = results.map((r) => ({
    teamId: r.team_id, position: r.position, shared: r.shared === 1, total: r.total, roundScores: JSON.parse(r.round_scores) as number[],
    roundWins: r.round_wins, decidedBy: r.decided_by, name: names.get(r.team_id) ?? "",
  }));
  const markChanges = db.query<{ team_id: string; question_id: string; from_mark: Mark; to_mark: Mark; at: number }, [string]>(
    "SELECT team_id, question_id, from_mark, to_mark, at FROM mark_changes WHERE night_id = ? ORDER BY id",
  ).all(nightId).map((c) => ({ teamId: c.team_id, questionId: c.question_id, from: c.from_mark, to: c.to_mark, at: c.at }));
  const sdQuestionIds = db.query<{ question_id: string }, [string]>(
    "SELECT question_id FROM sudden_deaths WHERE night_id = ? ORDER BY seq",
  ).all(nightId).map((r) => r.question_id);
  return { night, teams, standings, answers: loadAnswers(db, nightId), markChanges, sdQuestionIds };
}
