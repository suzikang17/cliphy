// Content script - runs on YouTube pages

function getVideoInfo() {
  const url = window.location.href;
  const videoId = new URL(url).searchParams.get("v");
  const title = document.title.replace(" - YouTube", "");
  return { videoId, title, url };
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_VIDEO_INFO") {
    sendResponse(getVideoInfo());
  }
  return true;
});

export {};
