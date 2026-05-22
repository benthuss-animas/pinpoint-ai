import express from 'express';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { DATA_DIR } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');

const router = express.Router();

function parseBug(bug) {
  if (!bug) return bug;
  try { bug.console_errors = JSON.parse(bug.console_errors || '[]'); } catch { bug.console_errors = []; }
  try { bug.component_path = JSON.parse(bug.component_path || 'null'); } catch { bug.component_path = null; }
  return bug;
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
  if (projectId) { sql += ' AND b.project_id = ?'; params.push(projectId); }
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
  parseBug(bug);
  bug.history = db.prepare('SELECT * FROM bug_history WHERE bug_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(bug);
});

// GET /api/bugs/:id/history
router.get('/:id/history', (req, res) => {
  res.json(db.prepare('SELECT * FROM bug_history WHERE bug_id = ? ORDER BY created_at ASC').all(req.params.id));
});

// GET /api/bugs/:id/screenshot
router.get('/:id/screenshot', (req, res) => {
  const bug = db.prepare('SELECT screenshot_path FROM bugs WHERE id = ?').get(req.params.id);
  if (!bug?.screenshot_path) return res.status(404).json({ error: 'No screenshot' });
  const filePath = path.join(DATA_DIR, bug.screenshot_path);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
  res.sendFile(filePath);
});

// POST /api/bugs
router.post('/', (req, res) => {
  const {
    projectId, title, description, type, priority,
    url, selector, elementHtml, consoleErrors, viewport, userAgent,
    componentPath, breakpointWidth, screenshot,
  } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  const insert = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO bugs (
        project_id, title, description, type, priority,
        url, selector, element_html, console_errors,
        viewport_w, viewport_h, user_agent,
        component_path, breakpoint_width
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId || null, title.trim(), description?.trim() || null,
      type || 'bug', priority || 'medium',
      url || null, selector || null, elementHtml || null,
      JSON.stringify(consoleErrors || []),
      viewport?.width || null, viewport?.height || null, userAgent || null,
      componentPath?.length ? JSON.stringify(componentPath) : null,
      breakpointWidth || null
    );
    db.prepare('INSERT INTO bug_history (bug_id, from_status, to_status) VALUES (?, NULL, ?)').run(lastInsertRowid, 'open');
    return lastInsertRowid;
  });

  const id = insert();

  if (screenshot?.startsWith('data:image/png;base64,')) {
    try {
      mkdirSync(SCREENSHOTS_DIR, { recursive: true });
      writeFileSync(
        path.join(SCREENSHOTS_DIR, `${id}.png`),
        screenshot.replace(/^data:image\/png;base64,/, ''), 'base64'
      );
      db.prepare('UPDATE bugs SET screenshot_path = ? WHERE id = ?').run(`screenshots/${id}.png`, id);
    } catch (err) {
      console.error('[Pinpoint] Failed to save screenshot:', err.message);
    }
  }

  res.json({ success: true, bug: parseBug(db.prepare('SELECT * FROM bugs WHERE id = ?').get(id)) });
});

// PATCH /api/bugs/:id
router.patch('/:id', (req, res) => {
  const { note, ...rest } = req.body;
  const map = { status: rest.status, title: rest.title, description: rest.description, priority: rest.priority, type: rest.type, project_id: rest.projectId };
  const entries = Object.entries(map).filter(([, v]) => v !== undefined);
  if (!entries.length) return res.json({ success: true });

  db.transaction(() => {
    if (map.status !== undefined) {
      const current = db.prepare('SELECT status FROM bugs WHERE id = ?').get(req.params.id);
      if (current && current.status !== map.status) {
        db.prepare('INSERT INTO bug_history (bug_id, from_status, to_status, note) VALUES (?, ?, ?, ?)')
          .run(req.params.id, current.status, map.status, note?.trim() || null);
      }
    }
    db.prepare(`UPDATE bugs SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...entries.map(([, v]) => v), req.params.id);
  })();

  res.json({ success: true });
});

// DELETE /api/bugs/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM bugs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
