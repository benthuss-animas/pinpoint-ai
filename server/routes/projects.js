import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
           COUNT(CASE WHEN b.status = 'open'   THEN 1 END) AS open_count,
           COUNT(CASE WHEN b.status = 'review' THEN 1 END) AS review_count,
           COUNT(b.id)                                      AS total_count
    FROM projects p
    LEFT JOIN bugs b ON b.project_id = p.id
    GROUP BY p.id
    ORDER BY p.name COLLATE NOCASE
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, urlPattern } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO projects (name, url_pattern) VALUES (?, ?)'
    ).run(name.trim(), urlPattern?.trim() || null);
    res.json({ success: true, project: db.prepare('SELECT * FROM projects WHERE id = ?').get(lastInsertRowid) });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'A project with that name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  const map = { name: req.body.name, url_pattern: req.body.urlPattern };
  const entries = Object.entries(map).filter(([, v]) => v !== undefined);
  if (!entries.length) return res.json({ success: true });
  db.prepare(`UPDATE projects SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), req.params.id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
