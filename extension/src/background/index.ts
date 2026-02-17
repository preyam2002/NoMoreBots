console.log("NoMoreBots: Background script running");

const DEFAULT_API_URL = "http://localhost:3000:3000/api/classify";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface ExtensionStats {
  scanned: number;
  hidden: number;
  sessions: number;
  lastSession: number;
}

interface BackgroundError {
  timestamp: number;
  type: string;
  message: string;
  stack?: string;
}

async function getApiUrl(): Promise<string> {
  const result = await chrome.storage.local.get(["apiUrl"]);
  return result.apiUrl || DEFAULT_API_URL;
}

async function getProvider(): Promise<string> {
  const result = await chrome.storage.local.get(["provider"]);
  return result.provider || "gemini";
}

async function getUserSettings() {
  const result = await chrome.storage.local.get([
    "apiUrl",
    "provider",
    "userApiKey",
    "userId",
    "enabled",
    "threshold",
  ]);
  return {
    apiUrl: result.apiUrl || DEFAULT_API_URL,
    provider: result.provider || "gemini",
    userApiKey: result.userApiKey || "",
    userId: result.userId || "",
    enabled: result.enabled !== false,
    threshold: result.threshold || 0.75,
  };
}

async function logError(error: Error, context?: string) {
  const errorEntry: BackgroundError = {
    timestamp: Date.now(),
    type: error.constructor.name,
    message: error.message,
    stack: error.stack,
  };

  try {
    const result = await chrome.storage.local.get(["errors"]);
    const errors = (result.errors as BackgroundError[]) || [];
    errors.push(errorEntry);
    if (errors.length > 50) {
      errors.shift();
    }
    await chrome.storage.local.set({ errors });
  } catch (e) {
    console.error("Failed to log error:", e);
  }

  console.error(`NoMoreBots Error${context ? ` [${context}]` : ""}:`, error);
}

async function trackEvent(event: string, data?: Record<string, unknown>) {
  try {
    const stats = await chrome.storage.local.get(["events"]);
    const events = (stats.events as Array<{ event: string; data?: Record<string, unknown>; timestamp: number }>) || [];
    events.push({
      event,
      data,
      timestamp: Date.now(),
    });
    if (events.length > 100) {
      events.shift();
    }
    await chrome.storage.local.set({ events });
  } catch (error) {
    console.error("Error tracking event:", error);
  }
}

async function trackSession() {
  try {
    const result = await chrome.storage.local.get<ExtensionStats>(["stats"]);
    const stats: ExtensionStats = result.stats || { scanned: 0, hidden: 0, sessions: 0, lastSession: 0 };
    
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;
    
    if (now - stats.lastSession > dayInMs) {
      stats.sessions += 1;
      stats.lastSession = now;
      await chrome.storage.local.set({ stats });
    }
  } catch (error) {
    await logError(error as Error, "trackSession");
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function classifyWithRetry(
  url: string,
  headers: Record<string, string>,
  body: string,
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
      });

      if (response.ok) {
        return response;
      }

      if (response.status >= 500) {
        lastError = new Error(`Server error: ${response.status}`);
        console.warn(`NoMoreBots: Retry ${attempt}/${retries} after server error`);
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        console.warn(`NoMoreBots: Retry ${attempt}/${retries} after error: ${lastError.message}`);
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const userId = crypto.randomUUID();

  const defaults = {
    userId,
    enabled: true,
    threshold: 0.75,
    stats: { scanned: 0, hidden: 0, sessions: 0, lastSession: 0 },
    userApiKey: "",
    apiUrl: DEFAULT_API_URL,
    provider: "gemini",
    filterEngagement: false,
    filterRagebait: false,
    filterHateSpeech: false,
    limitReached: false,
    events: [],
    errors: [],
  };

  const existing = await chrome.storage.local.get(Object.keys(defaults));
  const merged = { ...defaults, ...existing };
  await chrome.storage.local.set(merged);

  trackEvent("extension_installed", {
    reason: details.reason,
    previousVersion: details.previousVersion,
  });

  console.log("NoMoreBots: Extension installed/updated");
});

chrome.runtime.onStartup.addListener(async () => {
  await trackSession();
  trackEvent("extension_started");
});

chrome.commands.onCommand.addListener(async (command) => {
  console.log("NoMoreBots: Received command:", command);
  
  if (command === "toggle-filter") {
    const result = await chrome.storage.local.get(["enabled"]);
    const newEnabled = !result.enabled;
    await chrome.storage.local.set({ enabled: newEnabled });
    
    const tabs = await chrome.tabs.query({ url: ["*://*.twitter.com/*", "*://*.x.com/*"] });
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "FILTER_TOGGLED", enabled: newEnabled });
      }
    });
    
    trackEvent("filter_toggled", { enabled: newEnabled });
    
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "NoMoreBots",
      message: newEnabled ? "Filter enabled" : "Filter disabled",
    });
  } else if (command === "show-stats") {
    const result = await chrome.storage.local.get(["stats"]);
    const stats = result.stats || { scanned: 0, hidden: 0 };
    
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "NoMoreBots Stats",
      message: `Scanned: ${stats.scanned} | Hidden: ${stats.hidden}`,
    });
    
    trackEvent("stats_shown");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CLASSIFY_TWEETS") {
    (async () => {
      try {
        const settings = await getUserSettings();
        
        if (!settings.enabled) {
          sendResponse({ success: false, error: "Filter is disabled", status: 0 });
          return;
        }

        const response = await classifyWithRetry(
          settings.apiUrl,
          {
            "Content-Type": "application/json",
            "x-user-id": settings.userId,
            "x-api-key": settings.userApiKey,
            "x-provider": settings.provider,
          },
          JSON.stringify(message.body)
        );

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
        await logError(error as Error, "CLASSIFY_TWEETS");
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();

    return true;
  }

  if (message.type === "GET_SETTINGS") {
    (async () => {
      try {
        const settings = await getUserSettings();
        const stats = await chrome.storage.local.get(["stats", "limitReached"]);
        
        sendResponse({
          ...settings,
          stats: stats.stats || { scanned: 0, hidden: 0 },
          limitReached: stats.limitReached || false,
        });
      } catch (error) {
        await logError(error as Error, "GET_SETTINGS");
        sendResponse({ success: false, error: "Failed to get settings" });
      }
    })();

    return true;
  }

  if (message.type === "RESET_STATS") {
    (async () => {
      try {
        await chrome.storage.local.set({
          stats: { scanned: 0, hidden: 0, sessions: 0, lastSession: 0 },
        });
        trackEvent("stats_reset");
        sendResponse({ success: true });
      } catch (error) {
        await logError(error as Error, "RESET_STATS");
        sendResponse({ success: false, error: "Failed to reset stats" });
      }
    })();
    
    return true;
  }

  if (message.type === "GET_ERRORS") {
    (async () => {
      try {
        const result = await chrome.storage.local.get(["errors"]);
        sendResponse({ success: true, errors: result.errors || [] });
      } catch (error) {
        await logError(error as Error, "GET_ERRORS");
        sendResponse({ success: false, error: "Failed to get errors" });
      }
    })();
    
    return true;
  }

  if (message.type === "CLEAR_ERRORS") {
    (async () => {
      try {
        await chrome.storage.local.set({ errors: [] });
        sendResponse({ success: true });
      } catch (error) {
        await logError(error as Error, "CLEAR_ERRORS");
        sendResponse({ success: false, error: "Failed to clear errors" });
      }
    })();
    
    return true;
  }
});

setInterval(async () => {
  try {
    const result = await chrome.storage.local.get(["userId", "stats"]);
    if (!result.userId) return;
    console.log("NoMoreBots: Periodic sync completed");
  } catch (error) {
    await logError(error as Error, "periodicSync");
  }
}, 5 * 60 * 1000);

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url?.includes("twitter.com")) {
    await trackSession();
    trackEvent("tab_updated", { url: tab.url });
  }
});
