chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Only relay TAB_UPDATED for the tab the panel is watching, not every tab.
let panelTabId = null;

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && tabId === panelTabId) {
    chrome.runtime.sendMessage({ type: 'TAB_UPDATED', tabId }).catch(() => {});
  }
});

// Detect panel close via port disconnect — pagehide is unreliable for side panels
let panelPort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  panelPort = port;
  port.onMessage.addListener((msg) => {
    if (msg.type === 'PANEL_TAB') panelTabId = msg.tabId;
  });
  port.onDisconnect.addListener(() => {
    panelPort = null;
    if (panelTabId != null) chrome.tabs.sendMessage(panelTabId, { type: 'HIDE_PINS' }).catch(() => {});
    panelTabId = null;
  });
});

// Forward PIN_CLICKED from content script → side panel; capture screenshots on request
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.type === 'PIN_CLICKED') {
    if (panelPort) panelPort.postMessage({ type: 'PIN_CLICKED', bugId: msg.bugId });
    respond({ ok: true });
    return true;
  }
  if (msg.type === 'CAPTURE_SCREENSHOT') {
    chrome.tabs.captureVisibleTab(msg.windowId, { format: 'png' })
      .then(dataUrl => respond({ dataUrl }))
      .catch(err => respond({ error: err.message }));
    return true;
  }
});
