console.log("AI Tweet Filter: Background script running");

// Initialize default settings
chrome.runtime.onInstalled.addListener(() => {
  // Generate a random ID if not exists
  const userId = crypto.randomUUID();

  chrome.storage.local.get(["userId"], (result) => {
    if (!result.userId) {
      chrome.storage.local.set({
        userId: userId,
        enabled: true,
        threshold: 0.75,
        stats: { scanned: 0, hidden: 0 },
        userApiKey: "",
      });
    }
  });
});
