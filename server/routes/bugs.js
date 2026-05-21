import express from 'express';
import db from '../db.js';

const router = express.Router();

function parseBug(bug) {
  if (!bug) return bug;
  try { bug.console_errors = JSON.parse(bug.console_errors || '[]'); } catch { bug.console_errors = []; }
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

// POST /api/bugs
router.post('/', (req, res) => {
  const { projectId, title, description, type, priority, url, selector, xpath, elementHtml, consoleErrors, viewport, userAgent } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  const insert = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO bugs (project_id, title, description, type, priority, url, selector, xpath, element_html, console_errors, viewport_w, viewport_h, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId || null, title.trim(), description?.trim() || null,
      type || 'bug', priority || 'medium',
      url || null, selector || null, xpath || null, elementHtml || null,
      JSON.stringify(consoleErrors || []),
      viewport?.width || null, viewport?.height || null, userAgent || null
    );
    db.prepare('INSERT INTO bug_history (bug_id, from_status, to_status) VALUES (?, NULL, ?)').run(lastInsertRowid, 'open');
    return lastInsertRowid;
  });

  const id = insert();
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
