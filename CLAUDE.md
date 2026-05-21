# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project name

**Pinpoint** — do not use "bugherd" in any names (copyright concern).

## What this is

Pinpoint lets you click any element on a web page to file a bug/task to a local SQLite database, then have Claude Code fix those issues using sub-agents. The entry point is a **Chrome extension** (MV3, uses a side panel).

## Running the server

```bash
cd server
npm install        # first time only
npm start          # production
npm run dev        # auto-reload with --watch
```

Server runs on `http://localhost:3456`. No build step — plain ESM Node. Requires `server/.env` (copy from `.env.example`).

## Architecture

```
server/
  server.js           Express entry point (port 3456)
  db.js               better-sqlite3, WAL mode, schema migration on startup
  routes/
    bugs.js           CRUD for bugs table + bug_history tracking
    projects.js       CRUD for projects table
    github.js         Kept for future use
  public/index.html   Dashboard SPA (vanilla JS, no framework)

extension/            Chrome MV3 extension (load unpacked from this dir)
  manifest.json
  service-worker.js   Opens side panel on icon click; relays TAB_UPDATED
  content/
    content.js        Renders pin dots on elements with open bugs; handles pick mode
    content.css
  sidepanel/
    panel.html        Side panel UI
    panel.js          Communicates with content script and server API

data/
  pinpoint.db         SQLite database (auto-created, gitignored)
```

## Database schema

Three tables — all created/migrated in `db.js` on startup:

- `projects` — named groups with optional `url_pattern`
- `bugs` — the main issue records; `status` is `open` | `review` | `closed`
- `bug_history` — append-only status transition log per bug

## Key API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/bugs?status=open` | List bugs (filterable by `status`, `projectId`) |
| GET | `/api/bugs/:id` | Single bug + history |
| POST | `/api/bugs` | Create bug |
| PATCH | `/api/bugs/:id` | Update status/fields (logs history transition) |
| DELETE | `/api/bugs/:id` | Delete bug |
| GET | `/api/projects` | List projects with open/review/total counts |

## Fixing bugs with Claude Code

See `fix-issues.md` for the full workflow. The key rules:
- Bugs affecting **different files** → fix in **parallel** (one `Agent()` call per bug in a single message)
- Bugs affecting **same file** → fix **sequentially**
- After fixing, PATCH status to `review` (not `closed`) — humans approve in the dashboard

## Chrome extension

Load `extension/` as an unpacked extension in Chrome. The extension talks to `http://localhost:3456` — the server must be running. Content script injects pin dots; the side panel is the main UI. `pp-selected` and `pp-hovered` CSS classes on the highlight overlay are stripped from selectors before storage (see `db.js` and `content.js`).
