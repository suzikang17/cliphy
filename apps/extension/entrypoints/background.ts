import type { ExtensionMessage } from "@cliphy/shared";

export default defineBackground(() => {
  console.log("Cliphy extension installed");

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message as ExtensionMessage;

    switch (msg.type) {
      case "VIDEO_DETECTED":
        console.log("[Cliphy] Video detected:", msg.video);
        // TODO: integrate with queue system
        break;

      case "ADD_TO_QUEUE":
        // TODO: Send video to backend queue
        sendResponse({ success: true });
        break;
    }

    return true;
  });
});
