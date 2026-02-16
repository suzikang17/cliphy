// Background service worker - manages queue processing

chrome.runtime.onInstalled.addListener(() => {
  console.log("Cliphy extension installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ADD_TO_QUEUE") {
    // TODO: Send video to backend queue
    sendResponse({ success: true });
  }
  return true; // Keep message channel open for async response
});

export {};
