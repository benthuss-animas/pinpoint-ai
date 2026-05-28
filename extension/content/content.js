/**
 * Pinpoint content script
 * Runs on every http/https page. Responsibilities:
 *  1. Render pin dots on elements that have open issues for this URL
 *  2. Handle element-picking mode when activated by the side panel
 */

let SERVER = 'http://localhost:3456';

// Load user's custom server URL if set
chrome.storage.local.get('serverUrl', r => { if (r.serverUrl) SERVER = r.serverUrl; });

// ── Pin layer ─────────────────────────────────────────────────────────────
const pinLayer = document.createElement('div');
pinLayer.id = 'pp-pin-layer';
pinLayer.style.display = 'none'; // shown only while panel is open
// At document_start body may not exist yet — append to documentElement as fallback
(document.body || document.documentElement).appendChild(pinLayer);

// Map of bugId → { targetEl, pinEl }
const pins = new Map();

// Project currently shown in the panel (kept in sync via RELOAD_PINS messages)
let panelProjectId = null;

function cleanSelector(sel) {
  return sel.replace(/\.pp-selected|\.pp-hovered/g, '');
}

function renderPin(bug, seqNumber) {
  if (!bug.selector) return;
  const selector = cleanSelector(bug.selector);

  let targetEl;
  try { targetEl = document.querySelector(selector); } catch {}
  if (!targetEl) return;

  pins.get(bug.id)?.pinEl.remove();

  const priority = bug.priority || 'medium';
  const pin = document.createElement('div');
  pin.className = `pp-pin pp-pin-${priority}`;
  pin.dataset.bugId = bug.id;

  pin.innerHTML = `
    <div class="pp-pin-dot">${seqNumber}</div>
    <div class="pp-pin-tooltip">#${bug.id} ${escHtml(bug.title)}</div>
  `;

  const dot = pin.querySelector('.pp-pin-dot');
  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.pp-pin-dot.pp-pin-active')
      .forEach(d => d.classList.remove('pp-pin-active'));
    dot.classList.add('pp-pin-active');
    chrome.runtime.sendMessage({ type: 'PIN_CLICKED', bugId: bug.id }).catch(() => {});
  });

  pinLayer.appendChild(pin);
  pins.set(bug.id, { targetEl, pinEl: pin });
}

function repositionPins() {
  for (const { targetEl, pinEl } of pins.values()) {
    const rect = targetEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      pinEl.style.display = 'none';
      continue;
    }
    pinEl.style.display = '';
    pinEl.style.left = `${rect.right}px`;
    pinEl.style.top = `${rect.top}px`;
  }
}

async function loadPins(projectId) {
  panelOpen = true;
  pinLayer.style.display = '';
  pinLayer.innerHTML = '';
  pins.clear();

  try {
    const params = new URLSearchParams({ status: 'open,review' });
    if (projectId) params.set('projectId', projectId);
    const res = await fetch(`${SERVER}/api/bugs?${params}`);
    if (!res.ok) return;
    const bugs = await res.json();
    if (!Array.isArray(bugs)) return;

    const pageUrl = window.location.href;
    const relevant = bugs.filter(bug => {
      if (!bug.url) return false;
      try {
        return new URL(bug.url).pathname === new URL(pageUrl).pathname &&
               new URL(bug.url).origin === new URL(pageUrl).origin;
      } catch {
        return bug.url === pageUrl;
      }
    });

    relevant.forEach((bug, i) => renderPin(bug, i + 1));
    repositionPins();
  } catch {}
}

// ── Hover highlight (triggered by panel hovering an issue card) ────────────
let highlightedEl = null;

function setHighlight(selector) {
  clearHighlight();
  const clean = cleanSelector(selector);
  try {
    highlightedEl = document.querySelector(clean);
    if (highlightedEl) highlightedEl.classList.add('pp-highlighted');
  } catch {}
}

function clearHighlight() {
  if (highlightedEl) {
    highlightedEl.classList.remove('pp-highlighted');
    highlightedEl = null;
  }
}

// Reposition on scroll/resize
let rafPending = false;
function scheduleReposition() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    repositionPins();
  });
}
window.addEventListener('scroll', scheduleReposition, { passive: true });
window.addEventListener('resize', scheduleReposition, { passive: true });

// ── Element picking ────────────────────────────────────────────────────────
let overlay = null;
let hoveredEl = null;

function topPageElement(x, y) {
  const els = document.elementsFromPoint(x, y);
  return els.find(el => el !== overlay && el !== pinLayer && !pinLayer.contains(el)) || null;
}

// ── Selector generation ────────────────────────────────────────────────────
function isUnique(sel) {
  try { return document.querySelectorAll(sel).length === 1; } catch { return false; }
}

function minimalSegment(el) {
  const tag = el.tagName.toLowerCase();
  for (const attr of ['data-component', 'data-testid', 'data-cy', 'data-id', 'data-qa']) {
    if (el.hasAttribute(attr)) {
      const val = el.getAttribute(attr).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const cand = `[${attr}="${val}"]`;
      if (isUnique(cand)) return cand;
      const tagCand = `${tag}[${attr}="${val}"]`;
      if (isUnique(tagCand)) return tagCand;
    }
  }
  for (const cls of el.classList) {
    if (cls.startsWith('pp-')) continue;
    const cand = `${tag}.${CSS.escape(cls)}`;
    if (isUnique(cand)) return cand;
  }
  const sibs = el.parentElement
    ? Array.from(el.parentElement.children).filter(s => s.tagName === el.tagName)
    : [];
  if (sibs.length > 1) return `${tag}:nth-of-type(${sibs.indexOf(el) + 1})`;
  return tag;
}

function buildShortestPath(el) {
  const segments = [];
  let cur = el;
  while (cur && cur !== document.documentElement) {
    segments.unshift(minimalSegment(cur));
    const candidate = segments.join(' > ');
    if (isUnique(candidate)) return candidate;
    cur = cur.parentElement;
  }
  return segments.join(' > ');
}

function getCssSelector(el) {
  if (!el || el === document.body) return 'body';

  for (const attr of ['data-component', 'data-testid', 'data-cy', 'data-id', 'data-qa']) {
    if (el.hasAttribute(attr)) {
      const val = el.getAttribute(attr).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const cand = `[${attr}="${val}"]`;
      if (isUnique(cand)) return cand;
    }
  }

  if (el.id) {
    const cand = `#${CSS.escape(el.id)}`;
    if (isUnique(cand)) return cand;
  }

  if (el.hasAttribute('aria-label')) {
    const val = el.getAttribute('aria-label').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const cand = `${el.tagName.toLowerCase()}[aria-label="${val}"]`;
    if (isUnique(cand)) return cand;
  }

  return buildShortestPath(el);
}

function anchorToComponent(el, sel) {
  if (sel.startsWith('[data-component=')) return sel;
  let cur = el.parentElement;
  while (cur && cur !== document.documentElement) {
    if (cur.hasAttribute('data-component')) {
      const val = cur.getAttribute('data-component').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `[data-component="${val}"] ${sel}`;
    }
    cur = cur.parentElement;
  }
  return sel;
}

function getSelector(el) {
  const sel = getCssSelector(el);
  return anchorToComponent(el, sel);
}

function getComponentContext(el) {
  let cur = el.parentElement;
  while (cur && cur !== document.documentElement) {
    for (const attr of ['data-component', 'data-testid', 'data-cy', 'data-id', 'data-qa']) {
      if (cur.hasAttribute(attr)) return { attr, value: cur.getAttribute(attr) };
    }
    cur = cur.parentElement;
  }
  return null;
}

function getComponentPath(el) {
  const path = [];
  let cur = el.parentElement;
  while (cur && cur !== document.documentElement) {
    if (cur.hasAttribute('data-component')) path.push(cur.getAttribute('data-component'));
    cur = cur.parentElement;
  }
  return path.reverse();
}

// ── Console error bridge (MAIN world → isolated world via CustomEvent) ────
function readConsoleErrors() {
  return new Promise((resolve) => {
    const handler = (e) => {
      window.removeEventListener('pp-errors-data', handler);
      try { resolve(JSON.parse(e.detail)); } catch { resolve([]); }
    };
    window.addEventListener('pp-errors-data', handler);
    window.dispatchEvent(new CustomEvent('pp-read-errors'));
    // Fallback if console-capture.js didn't load
    setTimeout(() => {
      window.removeEventListener('pp-errors-data', handler);
      resolve([]);
    }, 200);
  });
}

function startPicking() {
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.id = 'pp-pick-overlay';
  document.body.appendChild(overlay);

  overlay.addEventListener('mousemove', (e) => {
    const el = topPageElement(e.clientX, e.clientY);
    if (!el) return;
    if (hoveredEl && hoveredEl !== el) hoveredEl.classList.remove('pp-hovered');
    hoveredEl = el;
    hoveredEl.classList.add('pp-hovered');
  });

  overlay.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = topPageElement(e.clientX, e.clientY);
    if (!el) return;

    // Capture everything synchronously before any await so DOM state is stable
    const elementHtml = el.outerHTML.slice(0, 2000);
    const selector = getSelector(el);
    const componentContext = getComponentContext(el);
    const componentPath = getComponentPath(el);
    const pickTime = Date.now();
    const domRect = el.getBoundingClientRect();
    const elementRect = {
      x: Math.round(domRect.x),
      y: Math.round(domRect.y),
      width: Math.round(domRect.width),
      height: Math.round(domRect.height),
    };
    el.classList.add('pp-selected');

    // Remove the overlay immediately so the user sees instant feedback;
    // console errors are read asynchronously after the UI clears.
    stopPicking(false);

    const rawErrors = await readConsoleErrors();
    const consoleErrors = rawErrors.filter(err => pickTime - err.ts <= 10000);

    chrome.runtime.sendMessage({
      type: 'ELEMENT_SELECTED',
      data: {
        selector,
        elementHtml,
        url: window.location.href,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio || 1,
        elementRect,
        userAgent: navigator.userAgent,
        consoleErrors,
        componentContext,
        componentPath,
      },
    });
  });
}

function stopPicking(removeSelection = true) {
  overlay?.remove();
  overlay = null;
  if (hoveredEl) {
    hoveredEl.classList.remove('pp-hovered');
    hoveredEl = null;
  }
  if (removeSelection) {
    document.querySelectorAll('.pp-selected').forEach(el => el.classList.remove('pp-selected'));
  }
}

function clearSelection() {
  document.querySelectorAll('.pp-selected').forEach(el => el.classList.remove('pp-selected'));
}

// ── Message listener ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  switch (msg.type) {
    case 'START_PICKING':
      startPicking();
      respond({ ok: true });
      break;
    case 'STOP_PICKING':
      stopPicking();
      respond({ ok: true });
      break;
    case 'CLEAR_SELECTION':
      clearSelection();
      respond({ ok: true });
      break;
    case 'RELOAD_PINS':
      panelProjectId = msg.projectId ?? null;
      loadPins(panelProjectId).then(() => respond({ ok: true }));
      return true; // async
    case 'HIDE_PINS':
      panelOpen = false;
      pinLayer.style.display = 'none';
      respond({ ok: true });
      break;
    case 'HIGHLIGHT_ELEMENT':
      setHighlight(msg.selector);
      respond({ ok: true });
      break;
    case 'UNHIGHLIGHT_ELEMENT':
      clearHighlight();
      respond({ ok: true });
      break;
  }
});

// ── Init ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let panelOpen = false;

function initBody() {
  if (pinLayer.parentElement !== document.body) {
    document.body.appendChild(pinLayer);
  }
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (panelOpen) loadPins(panelProjectId);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.body) {
  initBody();
} else {
  document.addEventListener('DOMContentLoaded', initBody, { once: true });
}
