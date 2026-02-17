export default defineBackground(() => {
  console.log("Cliphy extension installed");

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message as { type: string };
    if (msg.type === "ADD_TO_QUEUE") {
      // TODO: Send video to backend queue
      sendResponse({ success: true });
    }
    return true;
  });
});
