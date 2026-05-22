chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    chrome.runtime.sendMessage({ type: 'TAB_UPDATED', tabId }).catch(() => {});
  }
});

// Detect panel close via port disconnect — pagehide is unreliable for side panels
let panelPort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  panelPort = port;
  let tabId = null;
  port.onMessage.addListener((msg) => {
    if (msg.type === 'PANEL_TAB') tabId = msg.tabId;
  });
  port.onDisconnect.addListener(() => {
    panelPort = null;
    if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'HIDE_PINS' }).catch(() => {});
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
