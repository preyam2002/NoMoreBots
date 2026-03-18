import { DEFAULT_PLAN_ID, PLAN_DEFINITIONS, type PlanFeatureAccess, type PlanId } from "../../../shared/plans";
import { ADVANCED_FILTER_DEFAULTS } from "../../../shared/filters";
import {
  ensureClientIdentity,
  getClientAuthHeaders,
  getDefaultApiBaseUrl,
} from "../lib/identity";
import { fetchWithTimeout } from "../lib/network";

console.log("NoMoreBots: Background script running");

const DEFAULT_API_BASE_URL = getDefaultApiBaseUrl();
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 15000;

interface ExtensionStats {
  scanned: number;
  hidden: number;
  todayHidden: number;
  todayDate: string;
  sessions: number;
  lastSession: number;
  requestCount?: number;
  dailyLimit?: number;
}

interface BackgroundError {
  timestamp: number;
  type: string;
  message: string;
  stack?: string;
}

async function getUserSettings() {
  const result = await chrome.storage.local.get([
    "apiBaseUrl",
    "apiUrl",
    "provider",
    "userApiKey",
    "userId",
    "clientToken",
    "enabled",
    "threshold",
    "detectionMode",
    "activeOnTwitter",
    "activeOnLinkedin",
    "plan",
    "planFeatures",
  ]);

  const legacyApiUrl = result.apiUrl as string | undefined;
  const apiBaseUrl =
    (result.apiBaseUrl as string | undefined) ||
    (legacyApiUrl ? legacyApiUrl.replace(/\/api\/classify$/, "") : undefined) ||
    DEFAULT_API_BASE_URL;

  return {
    apiBaseUrl,
    provider: result.provider || "gemini",
    userApiKey: result.userApiKey || "",
    userId: result.userId || "",
    clientToken: result.clientToken || "",
    enabled: result.enabled !== false,
    threshold: result.threshold || 0.75,
    detectionMode: result.detectionMode || "blur",
    activeOnTwitter: result.activeOnTwitter !== false,
    activeOnLinkedin: result.activeOnLinkedin !== false,
    plan: (result.plan || DEFAULT_PLAN_ID) as PlanId,
    planFeatures: (result.planFeatures || PLAN_DEFINITIONS[DEFAULT_PLAN_ID].features) as PlanFeatureAccess,
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
    const result = await chrome.storage.local.get(["stats"]);
    const stats: ExtensionStats = result.stats || { scanned: 0, hidden: 0, todayHidden: 0, todayDate: "", sessions: 0, lastSession: 0 };

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
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers,
        body,
      }, REQUEST_TIMEOUT_MS);

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

  const defaults: Record<string, unknown> = {
    userId,
    clientToken: "",
    enabled: true,
    threshold: 0.75,
    stats: { scanned: 0, hidden: 0, todayHidden: 0, todayDate: "", sessions: 0, lastSession: 0 },
    userApiKey: "",
    apiBaseUrl: DEFAULT_API_BASE_URL,
    apiUrl: `${DEFAULT_API_BASE_URL}/api/classify`,
    provider: "gemini",
    detectionMode: "blur",
    activeOnTwitter: true,
    activeOnLinkedin: true,
    ...ADVANCED_FILTER_DEFAULTS,
    limitReached: false,
    featureBlocked: "",
    plan: DEFAULT_PLAN_ID,
    planFeatures: PLAN_DEFINITIONS[DEFAULT_PLAN_ID].features,
    history: [],
    events: [],
    errors: [],
  };

  const existing = await chrome.storage.local.get(Object.keys(defaults));
  const merged = { ...defaults, ...existing };
  await chrome.storage.local.set(merged);

  try {
    await ensureClientIdentity(DEFAULT_API_BASE_URL);
  } catch (error) {
    console.warn("NoMoreBots: Failed to register client identity during install", error);
  }

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
  if (command === "toggle-filter") {
    const result = await chrome.storage.local.get(["enabled"]);
    const newEnabled = !result.enabled;
    await chrome.storage.local.set({ enabled: newEnabled });

    const tabs = await chrome.tabs.query({ url: ["*://*.twitter.com/*", "*://*.x.com/*", "*://*.linkedin.com/*"] });
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "FILTER_TOGGLED", enabled: newEnabled });
      }
    });

    trackEvent("filter_toggled", { enabled: newEnabled });

    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.svg",
      title: "NoMoreBots",
      message: newEnabled ? "Filter enabled" : "Filter disabled",
    });
  } else if (command === "show-stats") {
    const result = await chrome.storage.local.get(["stats"]);
    const stats = result.stats || { scanned: 0, hidden: 0, todayHidden: 0 };

    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.svg",
      title: "NoMoreBots Stats",
      message: `Today: ${stats.todayHidden || 0} | Total: ${stats.hidden}`,
    });

    trackEvent("stats_shown");
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CLASSIFY_TWEETS") {
    (async () => {
      try {
        let settings = await getUserSettings();

        if (!settings.enabled) {
          sendResponse({ success: false, error: "Filter is disabled", status: 0 });
          return;
        }

        const identity = await ensureClientIdentity(settings.apiBaseUrl);
        settings = {
          ...settings,
          userId: identity.userId,
          clientToken: identity.clientToken,
          plan: identity.plan,
          planFeatures: identity.featureAccess,
        };

        const response = await classifyWithRetry(
          `${settings.apiBaseUrl}/api/classify`,
          {
            "Content-Type": "application/json",
            "x-user-id": settings.userId,
            "x-api-key": settings.userApiKey,
            "x-provider": settings.provider,
            ...getClientAuthHeaders(settings.clientToken),
          },
          JSON.stringify(message.body)
        );

        if (!response.ok) {
          let errorMessage = response.statusText;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || response.statusText;
            if (response.status === 403) {
              await chrome.storage.local.set({
                featureBlocked: errorMessage,
                plan: errorData.plan || DEFAULT_PLAN_ID,
                planFeatures: errorData.featureAccess || PLAN_DEFINITIONS[DEFAULT_PLAN_ID].features,
              });
            }
          } catch {
            // Ignore JSON parse errors for non-JSON responses.
          }

          if (response.status === 401) {
            await chrome.storage.local.set({
              featureBlocked: "Authentication expired. Open the popup to reconnect this device.",
            });
          }

          if (response.status === 402) {
            await chrome.storage.local.set({ limitReached: true });
          }
          sendResponse({
            success: false,
            error: errorMessage,
            status: response.status,
          });
          return;
        }

        const data = await response.json();
        const stored = await chrome.storage.local.get(["stats"]);
        const previousStats = (stored.stats as ExtensionStats | undefined) || {
          scanned: 0,
          hidden: 0,
          todayHidden: 0,
          todayDate: "",
          sessions: 0,
          lastSession: 0,
        };
        const nextStats: ExtensionStats = {
          ...previousStats,
          requestCount: data.usage?.requestCount,
          dailyLimit: data.usage?.dailyLimit,
        };

        await chrome.storage.local.set({
          userId: settings.userId,
          clientToken: settings.clientToken,
          plan: data.plan || DEFAULT_PLAN_ID,
          planFeatures: data.featureAccess || PLAN_DEFINITIONS[DEFAULT_PLAN_ID].features,
          stats: nextStats,
          limitReached: false,
          featureBlocked: "",
        });

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
        const data = await chrome.storage.local.get(["stats", "limitReached", "history", "featureBlocked"]);

        sendResponse({
          ...settings,
          stats: data.stats || { scanned: 0, hidden: 0, todayHidden: 0, todayDate: "" },
          limitReached: data.limitReached || false,
          featureBlocked: data.featureBlocked || "",
          historyCount: (data.history || []).length,
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
          stats: { scanned: 0, hidden: 0, todayHidden: 0, todayDate: "", sessions: 0, lastSession: 0 },
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

  // Forward page stats requests to the active tab
  if (message.type === "GET_PAGE_STATS_FROM_TAB") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_STATS" }, (response) => {
            sendResponse(response || { pageHidden: 0 });
          });
        } else {
          sendResponse({ pageHidden: 0 });
        }
      } catch {
        sendResponse({ pageHidden: 0 });
      }
    })();
    return true;
  }
});

setInterval(async () => {
  try {
    const result = await chrome.storage.local.get(["apiBaseUrl", "userId", "stats"]);
    if (!result.userId) {
      await ensureClientIdentity((result.apiBaseUrl as string | undefined) || DEFAULT_API_BASE_URL);
    }
  } catch (error) {
    await logError(error as Error, "periodicSync");
  }
}, 5 * 60 * 1000);

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && (tab.url?.includes("twitter.com") || tab.url?.includes("x.com") || tab.url?.includes("linkedin.com"))) {
    await trackSession();
    trackEvent("tab_updated", { url: tab.url });
  }
});
