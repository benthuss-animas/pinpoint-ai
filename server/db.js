import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '../data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'pinpoint.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    url_pattern TEXT,
    created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS bugs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    title         TEXT NOT NULL,
    description   TEXT,
    type          TEXT DEFAULT 'bug',
    priority      TEXT DEFAULT 'medium',
    status        TEXT DEFAULT 'open',
    url           TEXT,
    selector      TEXT,
    xpath         TEXT,
    element_html  TEXT,
    console_errors TEXT,
    viewport_w    INTEGER,
    viewport_h    INTEGER,
    user_agent    TEXT,
    created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS bug_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bug_id      INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
`);

for (const sql of [
  'ALTER TABLE bugs ADD COLUMN component_path TEXT',
  'ALTER TABLE bugs ADD COLUMN screenshot_path TEXT',
]) {
  try {
    db.exec(sql);
  } catch (err) {
    if (!err.message.includes('duplicate column')) throw err;
  }
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_bugs_status      ON bugs(status);
  CREATE INDEX IF NOT EXISTS idx_bugs_proj_status ON bugs(project_id, status);
  CREATE INDEX IF NOT EXISTS idx_bugs_created     ON bugs(created_at);
  CREATE INDEX IF NOT EXISTS idx_bug_history_bug  ON bug_history(bug_id);
`);

// Strip any .pp-selected / .pp-hovered classes that were accidentally captured in selectors
db.prepare(`UPDATE bugs SET selector = REPLACE(selector, '.pp-selected', '') WHERE selector LIKE '%.pp-selected%'`).run();
db.prepare(`UPDATE bugs SET selector = REPLACE(selector, '.pp-hovered', '')  WHERE selector LIKE '%.pp-hovered%'`).run();

export default db;
