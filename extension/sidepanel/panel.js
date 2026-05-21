let SERVER = 'http://localhost:3456';
let currentTab = null;
let selectedElement = null;
let projects = [];
let currentProjectId = null; // null = no project selected

// ── Views ─────────────────────────────────────────────────────────────────
function showView(name) {
  ['main','picking','form','settings'].forEach(v => {
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
          ${isReview ? `<button class="review-reopen" data-id="${bug.id}">Reopen</button>` : ''}
        </div>
        ${bug.selector ? `<div class="issue-sel">${escHtml(bug.selector)}</div>` : ''}
      `;
      if (bug.selector) {
        card.addEventListener('mouseenter', () => sendToContent({ type: 'HIGHLIGHT_ELEMENT', selector: bug.selector }));
        card.addEventListener('mouseleave', () => sendToContent({ type: 'UNHIGHLIGHT_ELEMENT' }));
      }
      if (isReview) {
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
  if (msg.type === 'ELEMENT_SELECTED') { selectedElement = msg.data; showFormView(); }
  if (msg.type === 'TAB_UPDATED') {
    if (document.getElementById('view-main').classList.contains('active-view')) loadMainView();
  }
});

function showFormView() {
  showView('form');
  document.getElementById('form-selector').textContent = selectedElement?.selector || '—';
  const btn = document.getElementById('btn-submit');
  btn.disabled = false;
  btn.textContent = 'Submit Issue →';
  document.getElementById('f-title').focus();
}

// ── Form submit ────────────────────────────────────────────────────────────
document.getElementById('btn-back').addEventListener('click', async () => {
  selectedElement = null;
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
    xpath: selectedElement?.xpath,
    elementHtml: selectedElement?.elementHtml,
    viewport: selectedElement?.viewport,
    consoleErrors: [],
    userAgent: selectedElement?.userAgent,
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
      selectedElement = null;
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
