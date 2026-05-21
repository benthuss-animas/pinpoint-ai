# Fix Open Pinpoint Issues

## CRITICAL RULE — READ FIRST

**After fetching the bug list, group bugs by the files they are likely to affect (use `url`, `selector`, and `element_html` to judge). Then apply these two rules:**

- **Different files → parallel.** Emit one `Agent()` call per bug in a single message, all at the same time. Do NOT fix them one at a time.
- **Same file → sequential.** If two bugs clearly target the same source file or component, run those agents one after the other so their edits don't conflict. Finish the first agent before launching the next.

When in doubt about overlap, err on the side of sequential — a conflict is worse than a small speed loss.

If you catch yourself doing independent bugs one at a time, stop and restart with all non-conflicting agents at once.

---

## Workflow

1. Fetch open bugs from the API (one request)
2. **Pre-flight file search:** For each bug, extract identifiers from `selector` (class names, IDs) and `element_html` (tag names, attribute values). Run `grep -r` across the project codebase for those identifiers and record the most likely source file as `likely_file`. Also check for `data-component` attributes — if present, they map directly to a component name.
3. Apply the parallel/sequential rules from the CRITICAL RULE above, then emit Agent calls — passing `likely_file` in each sub-agent prompt
4. Wait for all sub-agents to complete
5. Mark each fixed bug as `review` via PATCH — do NOT close them

---

## API reference

### Get all open bugs
```
GET http://localhost:3456/api/bugs?status=open
```
Returns: `[{ id, project_id, project_name, title, description, type, priority, status, url, selector, xpath, element_html, console_errors, viewport_w, viewport_h, created_at }]`

### Get open bugs for a specific project
```
GET http://localhost:3456/api/bugs?projectId=<id>&status=open
```

### List projects
```
GET http://localhost:3456/api/projects
```

### Mark a bug as ready for review (use this after fixing)
```
PATCH http://localhost:3456/api/bugs/<id>
Content-Type: application/json
{ "status": "review" }
```

---

## Sub-agent prompt (one per bug, all launched simultaneously)

Give each sub-agent the full bug JSON plus a `likely_file` hint from the pre-flight search, and these instructions:

1. **`likely_file`** — start here; confirm it's correct by checking the selector and element HTML against it before making changes
2. **`url`** — which page/route the bug is on
3. **`selector`** — CSS selector of the pinned element; use it to verify you're in the right file
4. **`element_html`** — outerHTML at report time; confirms you found the right element
5. **`description`** — structured as "Expected: … / What I saw: …"; use both halves to understand the intent of the fix
6. **`console_errors`** — any JS errors at time of report
7. If you need a screenshot to understand the visual layout or reproduce the bug, ask the user to upload one manually — do not assume a screenshot is available
8. Fix the bug with the minimal correct change
9. Report back what file(s) changed and why
10. PATCH the bug status to `review` — do NOT set it to `closed`

The human reviews changes in the dashboard and either Approves (→ closed) or Reopens (→ open) each bug.
