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

// Proxy API requests to avoid Mixed Content (HTTPS -> HTTP) blocking
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CLASSIFY_TWEETS") {
    const API_URL = "http://localhost:3000/api/classify";

    // We must return true to indicate we will send a response asynchronously
    (async () => {
      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: message.headers,
          body: JSON.stringify(message.body),
        });

        if (!response.ok) {
          sendResponse({
            success: false,
            error: response.statusText,
            status: response.status,
          });
          return;
        }

        const data = await response.json();
        sendResponse({ success: true, data });
      } catch (error) {
        console.error("Background API Fetch Error:", error);
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();

    return true; // Keep the message channel open for async response
  }
});
