import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, migrate, openDb, schemaVersion } from "../../src/server/db.ts";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function dbPath() {
  const d = mkdtempSync(join(tmpdir(), "lockin-db-"));
  dirs.push(d);
  return join(d, "lockin.db");
}

const EXPECTED: Record<string, string[]> = {
  meta: ["key", "value"],
  nights: ["id", "quiz_id", "quiz_title", "quiz_snapshot", "room_code", "status", "opened_at", "planned_start", "started_at", "ended_at", "end_reason", "prizes", "state"],
  teams: ["id", "night_id", "name", "name_key", "colour", "token_hash", "rejoin_code", "joker_round", "joined_at", "removed_at"],
  answers: ["night_id", "team_id", "question_id", "value", "received_at", "changes", "mark", "marked_by", "marked_at"],
  mark_changes: ["id", "night_id", "team_id", "question_id", "from_mark", "to_mark", "at"],
  sudden_deaths: ["night_id", "seq", "position", "team_ids", "question_id", "right_ids"],
  results: ["night_id", "team_id", "position", "shared", "total", "round_scores", "round_wins", "decided_by"],
  host_sessions: ["token_hash", "created_at", "last_seen_at", "expires_at"],
};

describe("database (TECH-SPEC 6.2)", () => {
  test("a fresh database has every table and column, and records schema_version", () => {
    const db = openDb(dbPath());
    const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    expect(tables).toEqual(Object.keys(EXPECTED).sort());
    for (const [table, cols] of Object.entries(EXPECTED)) {
      const actual = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((r) => r.name);
      expect(actual).toEqual(cols);
    }
    expect(schemaVersion(db)).toBe(MIGRATIONS.at(-1)!.version);
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()!.journal_mode).toBe("wal");
    expect(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()!.foreign_keys).toBe(1);
    db.close();
  });

  test("only one night can be open", () => {
    const db = openDb(dbPath());
    const add = db.query("INSERT INTO nights (id, quiz_id, quiz_title, quiz_snapshot, room_code, status, opened_at, state) VALUES (?, 'q', 'Q', '{}', 'BCDF', ?, 0, '{}')");
    add.run("n-1", "open");
    add.run("n-2", "ended");
    expect(() => add.run("n-3", "open")).toThrow();
    db.close();
  });

  test("check constraints hold", () => {
    const db = openDb(dbPath());
    expect(() => db.query("INSERT INTO nights (id, quiz_id, quiz_title, quiz_snapshot, room_code, status, opened_at, state) VALUES ('n', 'q', 'Q', '{}', 'BCDF', 'paused', 0, '{}')").run()).toThrow();
    db.close();
  });

  test("reopening runs no migration twice, and later migrations apply in order", () => {
    const path = dbPath();
    openDb(path).close();
    const db = openDb(path);
    expect(schemaVersion(db)).toBe(1);
    const v = migrate(db, [...MIGRATIONS, { version: 2, name: "002_test", sql: "CREATE TABLE extra (x INTEGER)" }]);
    expect(v).toBe(2);
    expect(schemaVersion(db)).toBe(2);
    expect(migrate(db, [...MIGRATIONS, { version: 2, name: "002_test", sql: "CREATE TABLE extra (x INTEGER)" }])).toBe(2);
    db.close();
  });

  test("a failing migration leaves the version unchanged", () => {
    const db = openDb(dbPath());
    expect(() => migrate(db, [...MIGRATIONS, { version: 2, name: "bad", sql: "CREATE TABLE nights (x)" }])).toThrow();
    expect(schemaVersion(db)).toBe(1);
    db.close();
  });
});
