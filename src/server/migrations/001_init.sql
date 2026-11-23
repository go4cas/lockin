-- TECH-SPEC 6.2 (contract). New tables need Cas's agreement.

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);       -- schema_version

CREATE TABLE nights (
  id            TEXT PRIMARY KEY,          -- "n-" + YYYYMMDD-HHMM + "-" + 4 chars
  quiz_id       TEXT NOT NULL,
  quiz_title    TEXT NOT NULL,
  quiz_snapshot TEXT NOT NULL,             -- QuizFile JSON as used, updated when answers are accepted
  room_code     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open','ended')),
  opened_at     INTEGER NOT NULL,
  planned_start INTEGER,                   -- nullable
  started_at    INTEGER,                   -- Quiz Start
  ended_at      INTEGER,                   -- Quiz End
  end_reason    TEXT CHECK (end_reason IN ('finished','early')),
  prizes        TEXT NOT NULL DEFAULT '[]',-- Prize[] JSON for this night
  state         TEXT NOT NULL              -- EngineState JSON (7.5), rewritten on every change
);
CREATE UNIQUE INDEX one_open_night ON nights(status) WHERE status = 'open';

CREATE TABLE teams (
  id           TEXT PRIMARY KEY,           -- "t-" + 8 chars
  night_id     TEXT NOT NULL REFERENCES nights(id),
  name         TEXT NOT NULL,
  name_key     TEXT NOT NULL,              -- lower-cased, trimmed, for uniqueness
  colour       INTEGER NOT NULL,           -- index into the theme's team colours (1-based)
  token_hash   TEXT,                       -- SHA-256 of the current device token; NULL while being moved
  rejoin_code  TEXT NOT NULL,
  joker_round  INTEGER,                    -- 0-based round index, NULL if not played
  joined_at    INTEGER NOT NULL,
  removed_at   INTEGER,                    -- removed before Quiz Start (H-06)
  UNIQUE (night_id, name_key),
  UNIQUE (night_id, rejoin_code)
);

CREATE TABLE answers (                     -- one row per team per question that has an answer or a mark
  night_id     TEXT NOT NULL REFERENCES nights(id),
  team_id      TEXT NOT NULL REFERENCES teams(id),
  question_id  TEXT NOT NULL,              -- a round question or a sudden-death question
  value        TEXT,                       -- AnswerValue JSON; NULL if the host marked a team that sent nothing
  received_at  INTEGER,                    -- server time of the last accepted submission
  changes      INTEGER NOT NULL DEFAULT 0, -- how many times the team changed it
  mark         TEXT NOT NULL DEFAULT 'pending' CHECK (mark IN ('pending','correct','wrong')),
  marked_by    TEXT CHECK (marked_by IN ('auto','host')),
  marked_at    INTEGER,
  PRIMARY KEY (night_id, team_id, question_id)
);

CREATE TABLE mark_changes (                -- every host change after the first mark (H-13)
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  night_id     TEXT NOT NULL, team_id TEXT NOT NULL, question_id TEXT NOT NULL,
  from_mark    TEXT NOT NULL, to_mark TEXT NOT NULL, at INTEGER NOT NULL
);

CREATE TABLE sudden_deaths (               -- one row per sudden-death question asked
  night_id     TEXT NOT NULL REFERENCES nights(id),
  seq          INTEGER NOT NULL,           -- 1.. across the night
  position     INTEGER NOT NULL,           -- the position being decided
  team_ids     TEXT NOT NULL,              -- JSON array of teams in it for this question
  question_id  TEXT NOT NULL,
  right_ids    TEXT,                       -- JSON array, set at reveal
  PRIMARY KEY (night_id, seq)
);

CREATE TABLE results (                     -- written at Quiz End (S-08)
  night_id     TEXT NOT NULL REFERENCES nights(id),
  team_id      TEXT NOT NULL REFERENCES teams(id),
  position     INTEGER NOT NULL,
  shared       INTEGER NOT NULL,           -- 1 if the position is shared
  total        INTEGER NOT NULL,
  round_scores TEXT NOT NULL,              -- JSON number[] per round, joker applied
  round_wins   INTEGER NOT NULL,
  decided_by   TEXT NOT NULL CHECK (decided_by IN ('points','tie_breaker','sudden_death','shared')),
  PRIMARY KEY (night_id, team_id)
);

CREATE TABLE host_sessions (
  token_hash   TEXT PRIMARY KEY,           -- SHA-256 of the cookie value
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
