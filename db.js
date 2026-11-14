// Database layer. Uses Node's built-in SQLite (node:sqlite), so there are no native
// dependencies to compile. The file lives at DATA_DIR/game.db (default ./data).
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'game.db');

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    categories  TEXT NOT NULL,              -- JSON array of category labels
    status      TEXT NOT NULL DEFAULT 'lobby', -- lobby | playing | finished
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS room_players (
    room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seat       INTEGER NOT NULL,
    joined_at  INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );

  -- One round = one player's turn in the hot seat.
  CREATE TABLE IF NOT EXISTS rounds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    number       INTEGER NOT NULL,
    subject_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phase        TEXT NOT NULL DEFAULT 'answering', -- answering | guessing | revealed
    created_at   INTEGER NOT NULL,
    locked_at    INTEGER,
    revealed_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS round_categories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id  INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    label     TEXT NOT NULL,
    answer    TEXT
  );

  CREATE TABLE IF NOT EXISTS guesses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id     INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submitted_at INTEGER NOT NULL,
    UNIQUE (round_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS guess_answers (
    guess_id     INTEGER NOT NULL REFERENCES guesses(id) ON DELETE CASCADE,
    category_id  INTEGER NOT NULL REFERENCES round_categories(id) ON DELETE CASCADE,
    value        TEXT NOT NULL,
    auto_correct INTEGER NOT NULL DEFAULT 0,
    override     INTEGER,               -- NULL = use auto; 0/1 = decided by the player in the hot seat
    PRIMARY KEY (guess_id, category_id)
  );

  CREATE INDEX IF NOT EXISTS idx_rounds_room ON rounds(room_id);
  CREATE INDEX IF NOT EXISTS idx_players_user ON room_players(user_id);
  CREATE INDEX IF NOT EXISTS idx_guesses_user ON guesses(user_id);
  CREATE INDEX IF NOT EXISTS idx_rc_round ON round_categories(round_id);
`);

// Lightweight migrations for databases created by older versions.
const roomCols = db.prepare('PRAGMA table_info(rooms)').all().map((c) => c.name);
if (!roomCols.includes('shuffle')) db.exec('ALTER TABLE rooms ADD COLUMN shuffle INTEGER NOT NULL DEFAULT 0');
// Game mode: how many guesses each player gets per category (1, 3 or 5).
if (!roomCols.includes('guess_count')) db.exec('ALTER TABLE rooms ADD COLUMN guess_count INTEGER NOT NULL DEFAULT 1');
const gaCols = db.prepare('PRAGMA table_info(guess_answers)').all().map((c) => c.name);
// All guesses for one category, as a JSON array (value holds them joined, for display/back-compat).
if (!gaCols.includes('vals')) db.exec('ALTER TABLE guess_answers ADD COLUMN vals TEXT');

// Small helper for multi-statement writes.
function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, tx, DB_FILE };
