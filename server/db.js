// Camada de persistencia. SQLite via better-sqlite3 (sincrono, sem servidor,
// um arquivo so). Suficiente e robusto para uma sala com dezenas de jogadores.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const dir = path.dirname(config.dbPath);
if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS solves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    challenge_id TEXT NOT NULL,
    points INTEGER NOT NULL,
    solved_at INTEGER NOT NULL,
    UNIQUE (user_id, challenge_id),
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS hints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    challenge_id TEXT NOT NULL,
    hint_index INTEGER NOT NULL,
    penalty INTEGER NOT NULL,
    revealed_at INTEGER NOT NULL,
    UNIQUE (user_id, challenge_id, hint_index),
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  -- Estado por jogador para desafios com efeito colateral (ex.: poisoning).
  CREATE TABLE IF NOT EXISTS player_state (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  -- Trilha de eventos, util para o instrutor acompanhar a turma ao vivo.
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    kind TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
`);

export const queries = {
  createUser: db.prepare(
    'INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)'
  ),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),

  recordSolve: db.prepare(
    'INSERT OR IGNORE INTO solves (user_id, challenge_id, points, solved_at) VALUES (?, ?, ?, ?)'
  ),
  solvesByUser: db.prepare('SELECT challenge_id, points, solved_at FROM solves WHERE user_id = ?'),
  hasSolve: db.prepare('SELECT 1 FROM solves WHERE user_id = ? AND challenge_id = ?'),

  revealHint: db.prepare(
    'INSERT OR IGNORE INTO hints (user_id, challenge_id, hint_index, penalty, revealed_at) VALUES (?, ?, ?, ?, ?)'
  ),
  hintsByUser: db.prepare('SELECT challenge_id, hint_index, penalty FROM hints WHERE user_id = ?'),

  setState: db.prepare(
    'INSERT INTO player_state (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value'
  ),
  getState: db.prepare('SELECT value FROM player_state WHERE user_id = ? AND key = ?'),

  logEvent: db.prepare(
    'INSERT INTO events (user_id, kind, detail, created_at) VALUES (?, ?, ?, ?)'
  ),

  // Reset por jogador: apaga apenas o progresso do proprio usuario.
  deleteSolves: db.prepare('DELETE FROM solves WHERE user_id = ?'),
  deleteHints: db.prepare('DELETE FROM hints WHERE user_id = ?'),
  deleteState: db.prepare('DELETE FROM player_state WHERE user_id = ?'),

  // Placar: pontos de solves menos penalidades de dicas, por jogador.
  scoreboard: db.prepare(`
    SELECT
      u.id AS user_id,
      COALESCE(u.display_name, u.username) AS name,
      COALESCE((SELECT SUM(points) FROM solves s WHERE s.user_id = u.id), 0)
        - COALESCE((SELECT SUM(penalty) FROM hints h WHERE h.user_id = u.id), 0) AS score,
      (SELECT COUNT(*) FROM solves s WHERE s.user_id = u.id) AS solved,
      (SELECT MAX(solved_at) FROM solves s WHERE s.user_id = u.id) AS last_solve
    FROM users u
    ORDER BY score DESC, last_solve ASC
  `),
};

export function logEvent(userId, kind, detail) {
  try {
    queries.logEvent.run(userId ?? null, kind, detail ? String(detail).slice(0, 500) : null, Date.now());
  } catch {
    // trilha e best-effort; nunca derruba o fluxo do jogo
  }
}
