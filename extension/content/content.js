/**
 * Pinpoint content script
 * Runs on every http/https page. Responsibilities:
 *  1. Render pin dots on elements that have open issues for this URL
 *  2. Handle element-picking mode when activated by the side panel
 */

const SERVER = 'http://localhost:3456';

// ── Pin layer ─────────────────────────────────────────────────────────────
const pinLayer = document.createElement('div');
pinLayer.id = 'pp-pin-layer';
pinLayer.style.display = 'none'; // shown only while panel is open
document.body.appendChild(pinLayer);

// Map of bugId → { targetEl, pinEl }
const pins = new Map();

function cleanSelector(sel) {
  // Strip any pinpoint highlight classes that may have been captured during recording
  return sel.replace(/\.pp-selected|\.pp-hovered/g, '');
}

function renderPin(bug, seqNumber) {
  if (!bug.selector) return;
  const selector = cleanSelector(bug.selector);

  let targetEl;
  try { targetEl = document.querySelector(selector); } catch (err) {
    console.log('[Pinpoint] querySelector threw for selector:', selector, err);
  }
  console.log('[Pinpoint] renderPin bug', bug.id, 'selector:', selector, '→ element:', targetEl);
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
    // rect coords are viewport-relative; pin layer is position:fixed so use them directly
    pinEl.style.left = `${rect.right}px`;
    pinEl.style.top = `${rect.top}px`;
  }
}

async function loadPins() {
  panelOpen = true;
  pinLayer.style.display = '';
  pinLayer.innerHTML = '';
  pins.clear();

  try {
    const res = await fetch(`${SERVER}/api/bugs?status=open,review`);
    console.log('[Pinpoint] loadPins fetch status:', res.status);
    if (!res.ok) return;
    const bugs = await res.json();
    console.log('[Pinpoint] bugs from server:', bugs.length, bugs);
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

    console.log('[Pinpoint] relevant for this page:', relevant.length, 'page:', pageUrl);
    relevant.forEach((bug, i) => renderPin(bug, i + 1));
    console.log('[Pinpoint] pins in map:', pins.size);
    repositionPins();
  } catch (err) {
    console.log('[Pinpoint] loadPins error:', err);
  }
}

// ── Hover highlight (triggered by panel hovering an issue card) ────────────
let highlightedEl = null;

function setHighlight(selector) {
  clearHighlight();
  const clean = cleanSelector(selector);
  try {
    highlightedEl = document.querySelector(clean);
    console.log('[Pinpoint] setHighlight selector:', clean, '→', highlightedEl);
    if (highlightedEl) highlightedEl.classList.add('pp-highlighted');
  } catch (err) {
    console.log('[Pinpoint] setHighlight error:', err);
  }
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

// Returns the topmost page element at (x, y), skipping our own overlay and pins.
// elementsFromPoint is more reliable than the pointerEvents toggle trick inside
// an event handler, where Chrome may not flush style changes synchronously.
function topPageElement(x, y) {
  const els = document.elementsFromPoint(x, y);
  return els.find(el => el !== overlay && el !== pinLayer && !pinLayer.contains(el)) || null;
}

function getCssSelector(el) {
  if (!el || el === document.body) return 'body';
  const path = [];
  let cur = el;
  while (cur && cur !== document.documentElement) {
    let sel = cur.tagName.toLowerCase();
    if (cur.id) {
      sel = `#${CSS.escape(cur.id)}`;
      path.unshift(sel);
      break;
    }
    const classes = Array.from(cur.classList).slice(0, 3)
      .map(c => `.${CSS.escape(c)}`).join('');
    sel += classes;
    const sibs = cur.parentElement
      ? Array.from(cur.parentElement.children).filter(s => s.tagName === cur.tagName)
      : [];
    if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
    path.unshift(sel);
    cur = cur.parentElement;
  }
  return path.join(' > ');
}

function getXPath(el) {
  if (!el) return '';
  const parts = [];
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.nodeName.toLowerCase();
    const sibs = node.parentNode
      ? Array.from(node.parentNode.children).filter(s => s.nodeName === node.nodeName)
      : [];
    parts.unshift(`${tag}${sibs.length > 1 ? `[${sibs.indexOf(node) + 1}]` : ''}`);
    node = node.parentNode;
  }
  return '/' + parts.join('/');
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

  overlay.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = topPageElement(e.clientX, e.clientY);
    if (!el) return;

    if (hoveredEl) hoveredEl.classList.remove('pp-hovered');

    // Capture everything before adding our own classes so they don't pollute the report
    const elementHtml = el.outerHTML.slice(0, 2000);
    const selector = getCssSelector(el);
    const xpath = getXPath(el);
    el.classList.add('pp-selected');

    chrome.runtime.sendMessage({
      type: 'ELEMENT_SELECTED',
      data: {
        selector,
        xpath,
        elementHtml,
        url: window.location.href,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        userAgent: navigator.userAgent,
      },
    });

    stopPicking(false); // stop overlay but leave selection highlight
  });
}

function stopPicking(clearHighlight = true) {
  overlay?.remove();
  overlay = null;
  if (hoveredEl) {
    hoveredEl.classList.remove('pp-hovered');
    hoveredEl = null;
  }
  if (clearHighlight) {
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
      loadPins().then(() => respond({ ok: true }));
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

// Re-load pins on SPA navigation only while panel is open
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (panelOpen) loadPins();
  }
}).observe(document.body, { childList: true, subtree: true });
