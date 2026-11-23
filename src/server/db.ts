// SQLite database (TECH-SPEC section 6): opening, pragmas and migrations.

import { Database } from "bun:sqlite";
import init001 from "./migrations/001_init.sql" with { type: "text" };

export interface Migration { version: number; name: string; sql: string }

/** Every migration, in order. A new table needs Cas's agreement (TECH-SPEC 3.2). */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "001_init", sql: init001 },
];

/** Opens (and creates if needed) the database, sets pragmas and runs pending migrations. */
export function openDb(path: string, migrations: readonly Migration[] = MIGRATIONS): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db, migrations);
  return db;
}

export function schemaVersion(db: Database): number {
  const hasMeta = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  if (!hasMeta) return 0;
  const row = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get();
  return row ? Number(row.value) : 0;
}

/** Applies every migration newer than the recorded schema_version, each in its own transaction. */
export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): number {
  let version = schemaVersion(db);
  for (const m of migrations) {
    if (m.version <= version) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.query("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(m.version));
    })();
    version = m.version;
  }
  return version;
}
