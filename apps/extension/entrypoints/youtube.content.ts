export default defineContentScript({
  matches: ["https://www.youtube.com/*"],

  main() {
    function getVideoInfo() {
      const url = window.location.href;
      const videoId = new URL(url).searchParams.get("v");
      const title = document.title.replace(" - YouTube", "");
      return { videoId, title, url };
    }

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const msg = message as { type: string };
      if (msg.type === "GET_VIDEO_INFO") {
        sendResponse(getVideoInfo());
      }
      return true;
    });
  },
});
