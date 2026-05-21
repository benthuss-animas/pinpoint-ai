# Pinpoint

Click any element on a web page to file a bug or task to a local SQLite database — with screenshot, CSS selector, console errors, and full context. Then tell Claude Code to fix open issues with sub-agents.

## How it works

```
Browser (any page)
  └─ Chrome extension side panel → pick mode
       └─ Click element → capture screenshot + selector + errors
            └─ POST /api/bugs → creates issue in local SQLite DB

Claude Code
  └─ "Fix open pinpoint issues" → fetches issues → spawns sub-agent per issue
       └─ Sub-agent reads screenshot, finds element in code, fixes it
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

### 4. Fix issues with Claude Code

Open a Claude Code session in your project directory and say:

```
Look at the open pinpoint issues and fix them using sub-agents.
Read fix-issues.md for the workflow.
```

Claude will fetch each open issue, read the screenshots, locate the code, and fix bugs in parallel.

## What each issue contains

- **CSS Selector** — precise selector for the element (e.g. `div.user-card > button.delete-btn`)
- **XPath** — backup locator
- **Element HTML** — the `outerHTML` of the element at report time
- **Console errors** — any JS errors captured at the moment of report
- **Page URL** — which page and path
- **Viewport** — browser window size
- **User Agent** — browser info
- **Screenshot** — saved as a local PNG file, path included in the issue

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
│   │   ├── content.js     # Pin dots + pick mode
│   │   └── content.css
│   └── sidepanel/
│       ├── panel.html
│       └── panel.js
├── fix-issues.md          # Claude Code prompt for fixing issues
└── .env.example
```
