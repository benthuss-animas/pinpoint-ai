# Pinpoint

Click any element on a web page to file a bug or task to a local SQLite database — with screenshot, CSS selector, console errors, component path, and full context. Then tell Claude Code to fix open issues with sub-agents.

## How it works

```
Browser (any page)
  └─ Chrome extension side panel → pick mode
       └─ Click element → capture screenshot + selector + console errors + component path
            └─ POST /api/bugs → creates issue in local SQLite DB

Claude Code
  └─ "Fix open pinpoint issues" → fetches issues → spawns sub-agent per issue
       └─ Sub-agent reads context, finds element in code, fixes it
```

## Setup

### 1. Start the server

```bash
cd server
npm install   # first time only
npm start
# or for auto-reload during development:
npm run dev
```

Server runs on `http://localhost:3456`.

### 2. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder

### 3. File a bug

1. Navigate to any local dev page
2. Click the Pinpoint icon in the Chrome toolbar to open the side panel
3. Click **Start Picking** in the side panel
4. Hover over the page — elements highlight as you move
5. Click the element where the bug is
6. Fill in the title, description, type, and priority
7. Hit **Submit Issue →**

The issue appears in the dashboard at `http://localhost:3456`.

### 4. Add the workflow to your project's CLAUDE.md

Copy this snippet into the `CLAUDE.md` file in **your project** (not this repo). Inlining the rules ensures Claude follows them without needing to be told to read a separate file first.

```markdown
## Bug tracker

Open bugs are tracked in Pinpoint at http://localhost:3456.

- This will fail: Bash(curl -s http://localhost:3456/api/bugs?status=open)
- Run this instead: Bash(curl -s "http://localhost:3456/api/bugs?status=open")

### Workflow — follow exactly

1. Fetch open bugs (one request)
2. For each bug, grep the codebase for class names / attributes in `selector` and `element_html` to find the likely source file; if `component_path` is present it maps directly to a component name
3. Group bugs by file: **same file → fix sequentially; different files → fix in parallel** using sub-agents
4. Fix with the minimal correct change
5. After fixing, PATCH each bug to `"status": "review"` — **never `"resolved"` or `"closed"`**

The human reviews changes in the Pinpoint dashboard and either approves (→ closed) or reopens (→ open).

### API

​```
GET   http://localhost:3456/api/bugs?status=open
      Returns: [{ id, project_id, project_name, title, description, type, priority,
                  status, url, selector, xpath, element_html, console_errors,
                  component_path, screenshot_path, viewport_w, viewport_h, created_at }]

PATCH http://localhost:3456/api/bugs/<id>   body: { "status": "review" }

GET   http://localhost:3456/api/bugs/<id>/screenshot   (PNG file)
​```
```

### 5. Fix issues with Claude Code

Open a Claude Code session in your project directory and say:

```
fix open bugs
```

Claude will fetch each open issue, locate the code, and fix bugs in parallel — then mark them ready for your review in the dashboard.

## What each issue contains

- **CSS Selector** — precise selector for the element (e.g. `div.user-card > button.delete-btn`)
- **XPath** — backup locator
- **Element HTML** — the `outerHTML` of the element at report time
- **Console errors** — `console.error`, `console.warn`, and uncaught exceptions captured from page load up to the moment of report
- **Component path** — framework component ancestry array (e.g. `["App", "UserList", "UserCard"]`), if detectable
- **Page URL** — which page and path
- **Viewport** — browser window size
- **User Agent** — browser info
- **Screenshot** — cropped PNG saved locally; served via `/api/bugs/:id/screenshot`

## Project structure

```
.
├── server/
│   ├── server.js          # Express server (port 3456)
│   ├── db.js              # SQLite schema + migrations
│   ├── routes/
│   │   ├── bugs.js        # CRUD for bugs
│   │   └── projects.js    # CRUD for projects
│   └── public/
│       └── index.html     # Dashboard SPA
├── extension/             # Chrome MV3 extension (load unpacked)
│   ├── manifest.json
│   ├── service-worker.js
│   ├── content/
│   │   ├── console-capture.js  # MAIN world; intercepts console errors before pick
│   │   ├── content.js          # Pin dots + pick mode
│   │   └── content.css
│   └── sidepanel/
│       ├── panel.html
│       └── panel.js
├── fix-issues.md          # Claude Code prompt for fixing issues
└── .env.example
```
