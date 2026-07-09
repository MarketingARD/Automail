import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.AUTOMAIL_DB || path.join(__dirname, '..', 'data', 'automail.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'pro',            -- 'pro' | 'private'
  color TEXT NOT NULL DEFAULT '#F6A98C',
  imap_host TEXT, imap_port INTEGER DEFAULT 993, imap_user TEXT, imap_pass TEXT,
  smtp_host TEXT, smtp_port INTEGER DEFAULT 465, smtp_user TEXT, smtp_pass TEXT,
  rag_enabled INTEGER NOT NULL DEFAULT 0,      -- la boîte alimente-t-elle la base RAG ?
  paused INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  domains TEXT NOT NULL DEFAULT '[]',          -- JSON: ["acme.com", "jean@perso.fr"]
  color TEXT NOT NULL DEFAULT '#7B68D8',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  uid INTEGER,
  folder TEXT NOT NULL DEFAULT 'INBOX',
  message_id TEXT,
  subject TEXT DEFAULT '',
  from_name TEXT DEFAULT '',
  from_email TEXT DEFAULT '',
  to_json TEXT DEFAULT '[]',
  date TEXT,
  snippet TEXT DEFAULT '',
  body_text TEXT DEFAULT '',
  body_html TEXT DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  -- triage bruit
  is_noise INTEGER NOT NULL DEFAULT 0,
  noise_score REAL DEFAULT 0,
  noise_reason TEXT DEFAULT '',
  noise_source TEXT DEFAULT '',                -- 'ai' | 'heuristic' | 'rule' | 'user'
  -- tâches
  task_detected INTEGER NOT NULL DEFAULT 0,
  task_json TEXT,                              -- {title, details, due}
  clickup_task_id TEXT,
  clickup_url TEXT,
  -- rattachement RAG
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  embedded INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, folder, uid)
);
CREATE INDEX IF NOT EXISTS idx_messages_triage ON messages(account_id, is_noise, deleted_at);
CREATE INDEX IF NOT EXISTS idx_messages_client ON messages(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC);

-- règles apprises quand l'utilisateur corrige le triage
CREATE TABLE IF NOT EXISTS sender_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,                -- adresse exacte ou @domaine
  action TEXT NOT NULL,                        -- 'noise' | 'keep'
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,                         -- 'private' | 'pro' | 'client:<id>'
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  chunk_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_embeddings_scope ON embeddings(scope);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- chaîne de fournisseurs IA (ordonnée) avec bascule automatique
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                          -- 'claude_subscription' | 'anthropic' | 'openai'
  preset TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_status TEXT NOT NULL DEFAULT 'unused',  -- 'ok'|'rate_limit'|'quota'|'auth'|'error'|'unused'
  last_error TEXT NOT NULL DEFAULT '',
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_providers_order ON providers(sort_order);
`);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value == null ? null : String(value));
}

export function allSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}
