chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    chrome.runtime.sendMessage({ type: 'TAB_UPDATED', tabId }).catch(() => {});
  }
});

// Detect panel close via port disconnect — pagehide is unreliable for side panels
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  let tabId = null;
  port.onMessage.addListener((msg) => {
    if (msg.type === 'PANEL_TAB') tabId = msg.tabId;
  });
  port.onDisconnect.addListener(() => {
    if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'HIDE_PINS' }).catch(() => {});
  });
});

