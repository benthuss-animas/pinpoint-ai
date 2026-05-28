import express from 'express';
import { mkdirSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import db, { DATA_DIR } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');
const SCREENSHOTS_DIR_RESOLVED = path.resolve(SCREENSHOTS_DIR) + path.sep;

const router = express.Router();

const VALID_STATUS   = new Set(['open', 'review', 'closed']);
const VALID_PRIORITY = new Set(['low', 'medium', 'high', 'critical']);
const VALID_TYPE     = new Set(['bug', 'task', 'enhancement']);

function parseBug(bug) {
  if (!bug) return bug;
  return {
    ...bug,
    console_errors: (() => { try { return JSON.parse(bug.console_errors || '[]'); } catch { return []; } })(),
    component_path: (() => { try { return JSON.parse(bug.component_path || 'null'); } catch { return null; } })(),
  };
}

// GET /api/bugs
router.get('/', (req, res) => {
  const { status, projectId } = req.query;
  let sql = `
    SELECT b.*, p.name AS project_name
    FROM bugs b
    LEFT JOIN projects p ON b.project_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
    sql += statuses.length === 1
      ? ' AND b.status = ?'
      : ` AND b.status IN (${statuses.map(() => '?').join(',')})`;
    params.push(...statuses);
  }
  if (projectId !== undefined && projectId !== '') {
    sql += ' AND b.project_id = ?';
    params.push(projectId);
  }
  sql += ' ORDER BY b.created_at DESC';
  res.json(db.prepare(sql).all(...params).map(parseBug));
});

// GET /api/bugs/:id
router.get('/:id', (req, res) => {
  const bug = db.prepare(`
    SELECT b.*, p.name AS project_name
    FROM bugs b LEFT JOIN projects p ON b.project_id = p.id
    WHERE b.id = ?
  `).get(req.params.id);
  if (!bug) return res.status(404).json({ error: 'Not found' });
  const parsed = parseBug(bug);
  parsed.history = db.prepare('SELECT * FROM bug_history WHERE bug_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(parsed);
});

// GET /api/bugs/:id/history
router.get('/:id/history', (req, res) => {
  res.json(db.prepare('SELECT * FROM bug_history WHERE bug_id = ? ORDER BY created_at ASC').all(req.params.id));
});

// GET /api/bugs/:id/screenshot
router.get('/:id/screenshot', (req, res) => {
  const bug = db.prepare('SELECT screenshot_path FROM bugs WHERE id = ?').get(req.params.id);
  if (!bug?.screenshot_path) return res.status(404).json({ error: 'No screenshot' });
  const resolved = path.resolve(DATA_DIR, bug.screenshot_path);
  if (!resolved.startsWith(SCREENSHOTS_DIR_RESOLVED)) {
    return res.status(400).json({ error: 'Invalid screenshot path' });
  }
  res.sendFile(resolved);
});

// POST /api/bugs
router.post('/', (req, res) => {
  const {
    projectId, title, description, type, priority,
    url, selector, elementHtml, consoleErrors, viewport, userAgent,
    componentPath, screenshot,
  } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  // Determine screenshot filename before the transaction so the path can be
  // included in the INSERT, making the DB row and file reference atomic.
  const screenshotFilename = screenshot?.startsWith('data:image/png;base64,')
    ? `${randomUUID()}.png`
    : null;

  const id = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO bugs (
        project_id, title, description, type, priority,
        url, selector, element_html, console_errors,
        viewport_w, viewport_h, user_agent,
        component_path, screenshot_path
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId || null, title.trim(), description?.trim() || null,
      type || 'bug', priority || 'medium',
      url || null, selector || null, elementHtml || null,
      JSON.stringify(consoleErrors || []),
      viewport?.width ?? null, viewport?.height ?? null, userAgent || null,
      componentPath?.length ? JSON.stringify(componentPath) : null,
      screenshotFilename ? `screenshots/${screenshotFilename}` : null
    );
    db.prepare('INSERT INTO bug_history (bug_id, from_status, to_status) VALUES (?, NULL, ?)').run(lastInsertRowid, 'open');
    return lastInsertRowid;
  })();

  if (screenshotFilename) {
    try {
      mkdirSync(SCREENSHOTS_DIR, { recursive: true });
      writeFileSync(
        path.join(SCREENSHOTS_DIR, screenshotFilename),
        screenshot.replace(/^data:image\/png;base64,/, ''), 'base64'
      );
    } catch (err) {
      console.error('[Pinpoint] Failed to save screenshot:', err.message);
      db.prepare('UPDATE bugs SET screenshot_path = NULL WHERE id = ?').run(id);
    }
  }

  const bug = db.prepare(`
    SELECT b.*, p.name AS project_name
    FROM bugs b LEFT JOIN projects p ON b.project_id = p.id
    WHERE b.id = ?
  `).get(id);
  res.json({ success: true, bug: parseBug(bug) });
});

// PATCH /api/bugs/:id
router.patch('/:id', (req, res) => {
  const { note, ...rest } = req.body;
  const map = {
    status:      rest.status,
    title:       rest.title,
    description: rest.description,
    priority:    rest.priority,
    type:        rest.type,
    project_id:  rest.projectId,
  };

  if (map.status !== undefined && !VALID_STATUS.has(map.status)) {
    return res.status(400).json({ error: `Invalid status '${map.status}'` });
  }
  if (map.priority !== undefined && !VALID_PRIORITY.has(map.priority)) {
    return res.status(400).json({ error: `Invalid priority '${map.priority}'` });
  }
  if (map.type !== undefined && !VALID_TYPE.has(map.type)) {
    return res.status(400).json({ error: `Invalid type '${map.type}'` });
  }

  const entries = Object.entries(map).filter(([, v]) => v !== undefined);
  if (!entries.length) return res.json({ success: true });

  const { changes } = db.transaction(() => {
    if (map.status !== undefined) {
      const current = db.prepare('SELECT status FROM bugs WHERE id = ?').get(req.params.id);
      if (current && current.status !== map.status) {
        db.prepare('INSERT INTO bug_history (bug_id, from_status, to_status, note) VALUES (?, ?, ?, ?)')
          .run(req.params.id, current.status, map.status, note?.trim() || null);
      }
    }
    return db.prepare(
      `UPDATE bugs SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    ).run(...entries.map(([, v]) => v), req.params.id);
  })();

  if (!changes) return res.status(404).json({ error: 'Bug not found' });
  res.json({ success: true });
});

// DELETE /api/bugs/:id
router.delete('/:id', (req, res) => {
  const bug = db.prepare('SELECT screenshot_path FROM bugs WHERE id = ?').get(req.params.id);
  if (!bug) return res.status(404).json({ error: 'Bug not found' });

  db.prepare('DELETE FROM bugs WHERE id = ?').run(req.params.id);

  if (bug.screenshot_path) {
    const filepath = path.resolve(DATA_DIR, bug.screenshot_path);
    if (filepath.startsWith(SCREENSHOTS_DIR_RESOLVED)) {
      try { unlinkSync(filepath); } catch {}
    }
  }

  res.json({ success: true });
});

export default router;
