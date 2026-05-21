import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, '../../screenshots');
const router = express.Router();

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GITHUB_OWNER;
const GH_REPO = process.env.GITHUB_REPO;
const LABEL = process.env.GITHUB_LABEL || 'pinpoint';

function ghFetch(endpoint, options = {}) {
  return fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function ensureLabel() {
  const res = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/labels/${LABEL}`);
  if (res.status === 404) {
    await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/labels`, {
      method: 'POST',
      body: JSON.stringify({ name: LABEL, color: 'e4e669', description: 'Filed via Pinpoint' }),
    });
  }
}

// POST /api/bugs — create a new bug
router.post('/', async (req, res) => {
  const {
    title,
    description,
    priority = 'medium',
    type = 'bug',
    url,
    selector,
    xpath,
    elementHtml,
    viewport,
    consoleErrors,
    screenshotDataUrl,
    userAgent,
  } = req.body;

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return res.status(500).json({ error: 'GitHub env vars not configured. Check GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO.' });
  }

  let screenshotPath = null;

  if (screenshotDataUrl) {
    try {
      await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
      const base64 = screenshotDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const filename = `bug-${Date.now()}.png`;
      screenshotPath = path.join(SCREENSHOTS_DIR, filename);
      await fs.writeFile(screenshotPath, Buffer.from(base64, 'base64'));
    } catch (err) {
      console.error('Failed to save screenshot:', err.message);
    }
  }

  const priorityEmoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' }[priority] || '🟡';
  const typeEmoji = { bug: '🐛', task: '📋', enhancement: '✨' }[type] || '🐛';

  const body = `## ${typeEmoji} ${type.charAt(0).toUpperCase() + type.slice(1)} Report

**Priority:** ${priorityEmoji} ${priority}
**URL:** \`${url}\`
**Timestamp:** ${new Date().toISOString()}
**Viewport:** ${viewport ? `${viewport.width}×${viewport.height}` : 'unknown'}
**User Agent:** ${userAgent || 'unknown'}

---

### Description

${description || '_No description provided._'}

---

### Element

**CSS Selector:** \`${selector || 'none'}\`
**XPath:** \`${xpath || 'none'}\`

\`\`\`html
${elementHtml || 'N/A'}
\`\`\`

---

### Console Errors at Time of Report

\`\`\`
${consoleErrors && consoleErrors.length ? consoleErrors.join('\n') : 'None'}
\`\`\`

---

### Screenshot

${screenshotPath ? `**Local path:** \`${screenshotPath}\`\n\n_Claude Code can read this file directly._` : '_No screenshot captured._'}

---

<!-- pinpoint-meta
selector: ${selector}
xpath: ${xpath}
url: ${url}
screenshot: ${screenshotPath || ''}
priority: ${priority}
type: ${type}
-->
`;

  try {
    await ensureLabel();

    const issueRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: `[${type.toUpperCase()}] ${title}`,
        body,
        labels: [LABEL, priority],
      }),
    });

    if (!issueRes.ok) {
      const err = await issueRes.text();
      return res.status(502).json({ error: `GitHub API error: ${err}` });
    }

    const issue = await issueRes.json();
    return res.json({ success: true, issue: { number: issue.number, url: issue.html_url } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/bugs — list open bugherd issues
router.get('/', async (req, res) => {
  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return res.status(500).json({ error: 'GitHub env vars not configured.' });
  }

  const state = req.query.state || 'open';

  try {
    const issueRes = await ghFetch(
      `/repos/${GH_OWNER}/${GH_REPO}/issues?labels=${LABEL}&state=${state}&per_page=50`
    );
    const issues = await issueRes.json();
    return res.json(issues);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/bugs/:number — close/update an issue
router.patch('/:number', async (req, res) => {
  const { number } = req.params;
  const { state } = req.body;

  try {
    const issueRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/issues/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    });
    const issue = await issueRes.json();
    return res.json({ success: true, issue });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
