/**
 * Khiam Store Extension - Background Service Worker (Manifest V3)
 * Opens index.html in a full independent tab on action click
 * and handles messaging between content scripts and the main warehouse app.
 */

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('index.html')
  });
});

// Listen for messages from content scripts (e.g., Operix batch export)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OPEN_SCANNER_WITH_DATA') {
    // Save batch orders to storage
    chrome.storage.local.set({ 'khiam_incoming_batch': request.payload }, () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL('index.html?source=operix')
      });
      sendResponse({ status: 'ok' });
    });
    return true; // Keep message channel open for async response
  }
});
