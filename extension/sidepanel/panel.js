let SERVER = 'http://localhost:3456';
let currentTab = null;
let selectedElement = null;
let pendingScreenshot = null;
let projects = [];
let currentProjectId = null; // null = no project selected

// ── Screenshot crop ───────────────────────────────────────────────────────
const CROP_PADDING = 48; // px around element (at CSS pixel scale)

function cropScreenshotToElement(dataUrl, elementData) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { elementRect, viewport, devicePixelRatio = 1 } = elementData;
      if (!elementRect || !viewport) { resolve(dataUrl); return; }

      // captureVisibleTab returns a bitmap scaled by devicePixelRatio
      const dpr = devicePixelRatio;
      const pad = CROP_PADDING;

      // Clamp crop rect to viewport bounds before scaling
      const cssX = Math.max(0, elementRect.x - pad);
      const cssY = Math.max(0, elementRect.y - pad);
      const cssRight  = Math.min(viewport.width,  elementRect.x + elementRect.width  + pad);
      const cssBottom = Math.min(viewport.height, elementRect.y + elementRect.height + pad);
      const cssW = cssRight  - cssX;
      const cssH = cssBottom - cssY;

      // Scale to physical pixels used in the captured bitmap
      const sx = Math.round(cssX * dpr);
      const sy = Math.round(cssY * dpr);
      const sw = Math.round(cssW * dpr);
      const sh = Math.round(cssH * dpr);

      const canvas = document.createElement('canvas');
      canvas.width  = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ── Views ─────────────────────────────────────────────────────────────────
function showView(name) {
  ['main','picking','form','settings','edit'].forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('active-view', v === name);
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ── Tab helpers ────────────────────────────────────────────────────────────
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
async function sendToContent(msg) {
  if (!currentTab) return;
  try { return await chrome.tabs.sendMessage(currentTab.id, msg); } catch {}
}

// ── Projects ───────────────────────────────────────────────────────────────
async function loadProjects() {
  try {
    const res = await fetch(`${SERVER}/api/projects`);
    projects = res.ok ? await res.json() : [];
  } catch { projects = []; }
}

function renderProjectSelect() {
  const sel = document.getElementById('project-select');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— No project —</option>';
  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name}${p.open_count > 0 ? ` (${p.open_count})` : ''}`;
    sel.appendChild(opt);
  });
  // Restore previous selection or auto-detected
  if (currentProjectId) sel.value = String(currentProjectId);
  else if (prev) sel.value = prev;
}

async function detectAndSelectProject(tabUrl) {
  if (!tabUrl) return;
  const origin = new URL(tabUrl).origin;

  // Check remembered project for this origin
  const key = `proj_${origin}`;
  const stored = await chrome.storage.local.get(key);
  if (stored[key]) {
    const found = projects.find(p => p.id === stored[key]);
    if (found) { currentProjectId = found.id; return; }
  }

  // Fall back to URL pattern matching
  const match = projects.find(p => p.url_pattern && tabUrl.startsWith(p.url_pattern));
  if (match) { currentProjectId = match.id; return; }

  currentProjectId = null;
}

async function rememberProject(projectId, tabUrl) {
  if (!tabUrl) return;
  try {
    const origin = new URL(tabUrl).origin;
    await chrome.storage.local.set({ [`proj_${origin}`]: projectId });
  } catch {}
}

document.getElementById('project-select').addEventListener('change', async (e) => {
  currentProjectId = e.target.value ? Number(e.target.value) : null;
  await rememberProject(currentProjectId, currentTab?.url);
  await loadPageIssues(currentTab?.url);
  await sendToContent({ type: 'RELOAD_PINS' });
});

// ── New project inline form ────────────────────────────────────────────────
document.getElementById('btn-new-proj').addEventListener('click', () => {
  const form = document.getElementById('new-proj-form');
  const isOpen = form.classList.contains('open');
  form.classList.toggle('open', !isOpen);
  if (!isOpen) {
    document.getElementById('np-name').value = '';
    document.getElementById('np-url').value = currentTab?.url ? new URL(currentTab.url).origin : '';
    document.getElementById('np-err').textContent = '';
    document.getElementById('np-name').focus();
  }
});

document.getElementById('np-cancel').addEventListener('click', () => {
  document.getElementById('new-proj-form').classList.remove('open');
});

document.getElementById('np-save').addEventListener('click', saveNewProject);
document.getElementById('np-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveNewProject(); });

async function saveNewProject() {
  const name = document.getElementById('np-name').value.trim();
  const urlPattern = document.getElementById('np-url').value.trim();
  const errEl = document.getElementById('np-err');
  if (!name) { errEl.textContent = 'Name required.'; return; }

  const res = await fetch(`${SERVER}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, urlPattern }),
  });
  const data = await res.json();
  if (!data.success) { errEl.textContent = data.error; return; }

  document.getElementById('new-proj-form').classList.remove('open');
  currentProjectId = data.project.id;
  await loadProjects();
  renderProjectSelect();
  await rememberProject(currentProjectId, currentTab?.url);
  await loadPageIssues(currentTab?.url);
}

// ── Main view ──────────────────────────────────────────────────────────────
async function loadMainView() {
  showView('main');
  currentTab = await getActiveTab();
  if (!currentTab) return;

  document.getElementById('page-url').textContent = currentTab.url || '—';
  document.getElementById('page-url').title = currentTab.url || '';

  await loadProjects();
  await detectAndSelectProject(currentTab.url);
  renderProjectSelect();

  notifyPanelTab();
  sendToContent({ type: 'RELOAD_PINS' });
  await loadPageIssues(currentTab.url);
}

function urlMatch(bugUrl, pageUrl) {
  if (!bugUrl || !pageUrl) return false;
  try {
    return new URL(bugUrl).pathname === new URL(pageUrl).pathname &&
           new URL(bugUrl).origin   === new URL(pageUrl).origin;
  } catch { return false; }
}

async function loadPageIssues(pageUrl) {
  const list = document.getElementById('issues-list');
  const errBanner = document.getElementById('server-err');
  try {
    const params = new URLSearchParams({ status: 'open,review' });
    if (currentProjectId) params.set('projectId', currentProjectId);
    const res = await fetch(`${SERVER}/api/bugs?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    errBanner.style.display = 'none';

    const bugs = await res.json();
    const open   = bugs.filter(b => b.status === 'open'   && urlMatch(b.url, pageUrl));
    const review = bugs.filter(b => b.status === 'review' && urlMatch(b.url, pageUrl));

    if (!open.length && !review.length) {
      list.innerHTML = '<div class="empty">No open issues on this page</div>';
      return;
    }

    list.innerHTML = '';

    function makeCard(bug, isReview) {
      const priority = bug.priority || 'medium';
      const card = document.createElement('div');
      card.className = 'issue-card' + (isReview ? ' review-card' : '');
      card.innerHTML = `
        <div class="issue-card-top">
          <div class="priority-dot pd-${priority}"></div>
          <div class="issue-title">${escHtml(bug.title)}</div>
          <div class="issue-num">#${bug.id}</div>
          ${isReview ? `<button class="review-close" data-id="${bug.id}">Close</button><button class="review-reopen" data-id="${bug.id}">Reopen</button>` : ''}
        </div>
        ${bug.selector ? `<div class="issue-sel">${escHtml(bug.selector)}</div>` : ''}
      `;
      if (bug.selector) {
        card.addEventListener('mouseenter', () => sendToContent({ type: 'HIGHLIGHT_ELEMENT', selector: bug.selector }));
        card.addEventListener('mouseleave', () => sendToContent({ type: 'UNHIGHLIGHT_ELEMENT' }));
      }
      card.addEventListener('click', (e) => {
        if (e.target.closest('.review-close') || e.target.closest('.review-reopen') || e.target.closest('.kickback-form')) return;
        openEditView(bug.id);
      });
      if (isReview) {
        card.querySelector('.review-close').addEventListener('click', async (e) => {
          e.stopPropagation();
          await fetch(`${SERVER}/api/bugs/${bug.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'closed' }) });
          await loadPageIssues(pageUrl);
          await sendToContent({ type: 'RELOAD_PINS' });
        });
        card.querySelector('.review-reopen').addEventListener('click', (e) => {
          e.stopPropagation();
          // Toggle inline kickback form
          if (card.querySelector('.kickback-form')) return;
          const form = document.createElement('div');
          form.className = 'kickback-form';
          form.innerHTML = `
            <textarea class="kickback-note" placeholder="Post-review notes (optional)…" rows="3"></textarea>
            <div class="kickback-actions">
              <button class="kb-skip">Skip</button>
              <button class="kb-save">Save &amp; Reopen</button>
            </div>
          `;
          card.appendChild(form);
          form.querySelector('.kickback-note').focus();

          async function doReopen(note) {
            const body = { status: 'open' };
            if (note) body.note = note;
            await fetch(`${SERVER}/api/bugs/${bug.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            await loadPageIssues(pageUrl);
            await sendToContent({ type: 'RELOAD_PINS' });
          }

          form.querySelector('.kb-skip').addEventListener('click', (e) => { e.stopPropagation(); doReopen(null); });
          form.querySelector('.kb-save').addEventListener('click', (e) => {
            e.stopPropagation();
            doReopen(form.querySelector('.kickback-note').value.trim() || null);
          });
          form.querySelector('.kickback-note').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              doReopen(form.querySelector('.kickback-note').value.trim() || null);
            }
          });
        });
      }
      return card;
    }

    if (open.length) {
      const label = document.createElement('div');
      label.className = 'issues-label';
      label.textContent = 'Open';
      list.appendChild(label);
      open.forEach(bug => list.appendChild(makeCard(bug, false)));
    }

    if (review.length) {
      const label = document.createElement('div');
      label.className = 'issues-label';
      label.style.color = '#a855f7';
      label.textContent = 'Ready for Review';
      list.appendChild(label);
      review.forEach(bug => list.appendChild(makeCard(bug, true)));
    }

  } catch {
    errBanner.style.display = '';
    list.innerHTML = '<div class="empty">No open issues on this page</div>';
  }
}

// ── Picking ────────────────────────────────────────────────────────────────
document.getElementById('btn-pick').addEventListener('click', async () => {
  showView('picking');
  await sendToContent({ type: 'START_PICKING' });
});
document.getElementById('btn-cancel-pick').addEventListener('click', async () => {
  await sendToContent({ type: 'STOP_PICKING' });
  await loadMainView();
});
document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape' && document.getElementById('view-picking').classList.contains('active-view')) {
    await sendToContent({ type: 'STOP_PICKING' });
    await loadMainView();
  }
});

// ── Element selected ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ELEMENT_SELECTED') {
    selectedElement = msg.data;
    pendingScreenshot = null;
    chrome.runtime.sendMessage(
      { type: 'CAPTURE_SCREENSHOT', windowId: currentTab?.windowId },
      (r) => {
        if (r?.dataUrl) {
          cropScreenshotToElement(r.dataUrl, msg.data)
            .then(cropped => { pendingScreenshot = cropped; })
            .catch(() => { pendingScreenshot = r.dataUrl; }); // fall back to full viewport
        }
      }
    );
    showFormView();
  }
  if (msg.type === 'TAB_UPDATED') {
    if (document.getElementById('view-main').classList.contains('active-view')) loadMainView();
  }
});

function showFormView() {
  showView('form');

  const ctx = selectedElement?.componentContext;
  const compEl = document.getElementById('form-component');
  if (ctx) {
    compEl.textContent = `In: ${ctx.value}`;
    compEl.style.display = '';
  } else {
    compEl.style.display = 'none';
  }

  document.getElementById('form-selector').textContent = selectedElement?.selector || '—';

  const errCount = (selectedElement?.consoleErrors || []).length;
  const badge = document.getElementById('form-console-errors');
  if (errCount > 0) {
    badge.textContent = `${errCount} console error${errCount > 1 ? 's' : ''} captured`;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = false;
  btn.textContent = 'Submit Issue →';
  document.getElementById('f-title').focus();
}

// ── Form submit ────────────────────────────────────────────────────────────
document.getElementById('btn-back').addEventListener('click', async () => {
  selectedElement = null;
  pendingScreenshot = null;
  document.getElementById('f-screenshot').checked = false;
  await sendToContent({ type: 'CLEAR_SELECTION' });
  await loadMainView();
});

document.getElementById('btn-submit').addEventListener('click', async () => {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { toast('Please enter a title.', 'error'); document.getElementById('f-title').focus(); return; }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true; btn.textContent = 'Submitting…';

  const payload = {
    projectId: currentProjectId || null,
    title,
    description: [
      document.getElementById('f-expected').value.trim() && `**Expected:** ${document.getElementById('f-expected').value.trim()}`,
      document.getElementById('f-actual').value.trim() && `**What I saw:** ${document.getElementById('f-actual').value.trim()}`,
    ].filter(Boolean).join('\n\n') || null,
    type: document.getElementById('f-type').value,
    priority: document.getElementById('f-priority').value,
    url: selectedElement?.url,
    selector: selectedElement?.selector,
    elementHtml: selectedElement?.elementHtml,
    viewport: selectedElement?.viewport,
    consoleErrors: selectedElement?.consoleErrors || [],
    userAgent: selectedElement?.userAgent,
    componentPath: selectedElement?.componentPath || [],
    screenshot: (document.getElementById('f-screenshot').checked && pendingScreenshot)
      ? pendingScreenshot : null,
  };

  try {
    const res = await fetch(`${SERVER}/api/bugs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      toast(`Issue #${data.bug.id} filed ✓`, 'success');
      document.getElementById('f-title').value = '';
      document.getElementById('f-expected').value = '';
      document.getElementById('f-actual').value = '';
      document.getElementById('f-screenshot').checked = false;
          selectedElement = null;
      pendingScreenshot = null;
      await sendToContent({ type: 'RELOAD_PINS' });
      await loadMainView();
    } else {
      toast(`Error: ${data.error}`, 'error');
      btn.disabled = false; btn.textContent = 'Submit Issue →';
    }
  } catch (err) {
    toast(`Network error: ${err.message}`, 'error');
    btn.disabled = false; btn.textContent = 'Submit Issue →';
  }
});

// ── Edit view ─────────────────────────────────────────────────────────────
let editingBugId = null;

function parseDescription(desc) {
  if (!desc) return { expected: '', actual: '' };
  const expMatch = desc.match(/\*\*Expected:\*\*\s*([\s\S]*?)(?:\n\n|$)/);
  const actMatch = desc.match(/\*\*What I saw:\*\*\s*([\s\S]*?)(?:\n\n|$)/);
  return {
    expected: expMatch ? expMatch[1].trim() : '',
    actual: actMatch ? actMatch[1].trim() : '',
  };
}

async function openEditView(bugId) {
  editingBugId = bugId;
  showView('edit');

  document.getElementById('edit-bug-num').textContent = '';
  document.getElementById('edit-status-badge').textContent = '';
  document.getElementById('e-title').value = '';
  document.getElementById('e-expected').value = '';
  document.getElementById('e-actual').value = '';

  try {
    const res = await fetch(`${SERVER}/api/bugs/${bugId}`);
    if (!res.ok) { toast('Could not load issue.', 'error'); await loadMainView(); return; }
    const bug = await res.json();

    document.getElementById('edit-bug-num').textContent = `#${bug.id}`;
    const badge = document.getElementById('edit-status-badge');
    badge.textContent = bug.status;
    badge.className = `edit-status-badge status-${bug.status}`;

    document.getElementById('e-title').value = bug.title || '';
    document.getElementById('e-type').value = bug.type || 'bug';
    document.getElementById('e-priority').value = bug.priority || 'medium';

    const { expected, actual } = parseDescription(bug.description);
    document.getElementById('e-expected').value = expected;
    document.getElementById('e-actual').value = actual;

    const selRow = document.getElementById('e-selector-row');
    if (bug.selector) {
      document.getElementById('e-selector').textContent = bug.selector;
      selRow.style.display = '';
      sendToContent({ type: 'HIGHLIGHT_ELEMENT', selector: bug.selector });
    } else {
      selRow.style.display = 'none';
    }

    document.getElementById('e-title').focus();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
    await loadMainView();
  }
}

document.getElementById('btn-edit-save').addEventListener('click', async () => {
  const title = document.getElementById('e-title').value.trim();
  if (!title) { toast('Title is required.', 'error'); document.getElementById('e-title').focus(); return; }

  const expected = document.getElementById('e-expected').value.trim();
  const actual = document.getElementById('e-actual').value.trim();
  const description = [
    expected && `**Expected:** ${expected}`,
    actual   && `**What I saw:** ${actual}`,
  ].filter(Boolean).join('\n\n') || null;

  const btn = document.getElementById('btn-edit-save');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const res = await fetch(`${SERVER}/api/bugs/${editingBugId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        type: document.getElementById('e-type').value,
        priority: document.getElementById('e-priority').value,
      }),
    });
    const data = await res.json();
    if (data.success) {
      toast('Saved ✓', 'success');
      sendToContent({ type: 'UNHIGHLIGHT_ELEMENT' });
      await sendToContent({ type: 'RELOAD_PINS' });
      await loadMainView();
    } else {
      toast(`Error: ${data.error}`, 'error');
      btn.disabled = false; btn.textContent = 'Save →';
    }
  } catch (err) {
    toast(`Network error: ${err.message}`, 'error');
    btn.disabled = false; btn.textContent = 'Save →';
  }
});

document.getElementById('btn-edit-delete').addEventListener('click', async () => {
  const btn = document.getElementById('btn-edit-delete');
  if (btn.dataset.confirm !== '1') {
    btn.textContent = 'Confirm delete';
    btn.dataset.confirm = '1';
    setTimeout(() => {
      if (btn.dataset.confirm === '1') {
        btn.textContent = 'Delete';
        delete btn.dataset.confirm;
      }
    }, 3000);
    return;
  }
  try {
    await fetch(`${SERVER}/api/bugs/${editingBugId}`, { method: 'DELETE' });
    toast('Deleted.', 'success');
    sendToContent({ type: 'UNHIGHLIGHT_ELEMENT' });
    await sendToContent({ type: 'RELOAD_PINS' });
    editingBugId = null;
    await loadMainView();
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'error');
  }
});

document.getElementById('btn-edit-cancel').addEventListener('click', async () => {
  editingBugId = null;
  sendToContent({ type: 'UNHIGHLIGHT_ELEMENT' });
  await loadMainView();
});

// ── Settings ───────────────────────────────────────────────────────────────
document.getElementById('btn-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: SERVER });
});

document.getElementById('btn-settings').addEventListener('click', () => showView('settings'));
document.getElementById('btn-save-settings').addEventListener('click', async () => {
  SERVER = document.getElementById('s-server').value.trim() || SERVER;
  await chrome.storage.local.set({ serverUrl: SERVER });
  const status = document.getElementById('settings-status');
  try {
    const res = await fetch(`${SERVER}/health`);
    status.textContent = res.ok ? '✓ Connected' : `Error ${res.status}`;
    status.className = res.ok ? 'status-msg' : 'status-msg error';
  } catch (e) {
    status.textContent = `Unreachable`;
    status.className = 'status-msg error';
  }
});

document.getElementById('btn-refresh').addEventListener('click', async () => {
  await sendToContent({ type: 'RELOAD_PINS' });
  await loadMainView();
});

// ── Utilities ──────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Port to service worker — disconnect signals panel closed ───────────────
let _port = connectPort();
function connectPort() {
  const p = chrome.runtime.connect({ name: 'sidepanel' });
  p.onMessage.addListener((msg) => {
    if (msg.type === 'PIN_CLICKED') openEditView(msg.bugId);
  });
  p.onDisconnect.addListener(() => { _port = connectPort(); }); // reconnect if SW restarts
  return p;
}
function notifyPanelTab() {
  if (currentTab) _port.postMessage({ type: 'PANEL_TAB', tabId: currentTab.id });
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get('serverUrl');
  if (stored.serverUrl) { SERVER = stored.serverUrl; document.getElementById('s-server').value = SERVER; }
  await loadMainView();
}

init();
