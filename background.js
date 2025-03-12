/**
 * WebTasks - Background Service Worker
 * 
 * This service worker handles the extension's background operations,
 * primarily managing the sidebar panel and responding to user actions.
 */

// Open the side panel when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) {
    console.error('Invalid tab provided to action handler');
    return;
  }
  
  chrome.sidePanel.open({ tabId: tab.id })
    .catch(error => {
      console.error('Error opening sidebar:', error);
    });
});

// Initialize extension when installed
chrome.runtime.onInstalled.addListener((details) => {
  console.log('WebTasks extension installed or updated:', details.reason);
});
