import { TweetClassification } from "../../../shared/types";
import { DEFAULT_PLAN_ID, PLAN_DEFINITIONS, type PlanFeatureAccess, type PlanId, type SupportedPlatform } from "../../../shared/plans";

console.log("NoMoreBots: Content script loaded");

// Detection mode types
type DetectionMode = "blur" | "hide" | "label";

// State management
let processedTweets = new Set<string>();
let processedTweetOrder: string[] = [];
let inFlightTweets = new Set<string>();
let pageHiddenCount = 0;
let tweetQueue: {
  id: string;
  text: string;
  element: HTMLElement;
  authorHandle: string;
  authorLocation?: string;
  context?: string;
  quotedText?: string;
  mediaSummary?: string;
  isReply?: boolean;
  retries: number;
}[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | undefined;
const MAX_RETRIES = 3;
const BATCH_SIZE = 10;
const FLUSH_DELAY = 800; // ms
const MAX_TRACKED_TWEETS = 5000;

// Settings cache
let settingsCache: {
  enabled: boolean;
  threshold: number;
  userId: string;
  userApiKey: string;
  provider: string;
  detectionMode: DetectionMode;
  activeOnTwitter: boolean;
  activeOnLinkedin: boolean;
  plan: PlanId;
  planFeatures: PlanFeatureAccess;
} | null = null;

// History log stored in memory, synced to storage
let historyLog: {
  tweetId: string;
  authorHandle: string;
  text: string;
  label: string;
  reason: string;
  confidence: number;
  timestamp: number;
  url: string;
}[] = [];

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get([
      "enabled",
      "threshold",
      "userId",
      "userApiKey",
      "provider",
      "detectionMode",
      "activeOnTwitter",
      "activeOnLinkedin",
      "plan",
      "planFeatures",
      "history",
    ]);

    const planFeatures = (result.planFeatures || PLAN_DEFINITIONS[DEFAULT_PLAN_ID].features) as PlanFeatureAccess;
    const storedDetectionMode = (result.detectionMode || "blur") as DetectionMode;
    const detectionMode = planFeatures.detectionModes.includes(storedDetectionMode)
      ? storedDetectionMode
      : "blur";

    settingsCache = {
      enabled: result.enabled !== false,
      threshold: result.threshold || 0.75,
      userId: result.userId || "",
      userApiKey: result.userApiKey || "",
      provider: result.provider || "gemini",
      detectionMode,
      activeOnTwitter: result.activeOnTwitter !== false,
      activeOnLinkedin: planFeatures.linkedinScanning && result.activeOnLinkedin !== false,
      plan: (result.plan || DEFAULT_PLAN_ID) as PlanId,
      planFeatures,
    };

    historyLog = result.history || [];

    return settingsCache;
  } catch (error) {
    console.error("Error loading settings:", error);
    return {
      enabled: true,
      threshold: 0.75,
      userId: "",
      userApiKey: "",
      provider: "gemini",
      detectionMode: "blur" as DetectionMode,
      activeOnTwitter: true,
      activeOnLinkedin: true,
      plan: DEFAULT_PLAN_ID,
      planFeatures: PLAN_DEFINITIONS[DEFAULT_PLAN_ID].features,
    };
  }
}

// Listen for settings changes
chrome.storage.onChanged.addListener((changes) => {
  if (
    changes.enabled ||
    changes.threshold ||
    changes.userApiKey ||
    changes.provider ||
    changes.detectionMode ||
    changes.activeOnTwitter ||
    changes.activeOnLinkedin ||
    changes.plan ||
    changes.planFeatures
  ) {
    loadSettings().then(() => {
      // If detection mode changed, re-apply to all existing overlays
      if (changes.detectionMode || changes.planFeatures) {
        reapplyDetectionMode();
      }
    });
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_PAGE_STATS") {
    sendResponse({ pageHidden: pageHiddenCount });
    return;
  }
  if (message.type === "CLEAR_HISTORY") {
    historyLog = [];
    chrome.storage.local.set({ history: [] });
    sendResponse({ success: true });
    return;
  }
});

function reapplyDetectionMode() {
  const mode = settingsCache?.detectionMode || "blur";
  document.querySelectorAll('[data-nmb-mode]').forEach((el) => {
    const element = el as HTMLElement;
    const tweetEl = element.closest('[data-nmb-filtered]') as HTMLElement;
    if (!tweetEl) return;

    // Remove existing treatment
    element.remove();
    tweetEl.removeAttribute('data-nmb-filtered');
    tweetEl.style.filter = "";
    tweetEl.style.opacity = "";
    tweetEl.style.display = "";

    // Get stored data
    const prob = parseFloat(tweetEl.getAttribute('data-nmb-probability') || "0");
    const reason = tweetEl.getAttribute('data-nmb-reason') || "";
    const label = tweetEl.getAttribute('data-nmb-label') || "";

    applyDetectionMode(tweetEl, prob, reason, label, mode);
  });
}

function getCurrentPlatform(): "twitter" | "linkedin" | "unknown" {
  const url = window.location.hostname;
  if (url.includes("twitter.com") || url.includes("x.com")) return "twitter";
  if (url.includes("linkedin.com")) return "linkedin";
  return "unknown";
}

function extractAuthorHandle(tweetElement: HTMLElement): string | undefined {
  const platform = getCurrentPlatform();

  if (platform === "linkedin") {
    // LinkedIn: find author from post header
    const authorLink = tweetElement.querySelector('.update-components-actor__name a, .feed-shared-actor__name a, a.app-aware-link[href*="/in/"]');
    if (authorLink) {
      const href = authorLink.getAttribute("href");
      if (href) {
        const match = href.match(/\/in\/([^/?]+)/);
        if (match) return match[1];
      }
    }
    const nameSpan = tweetElement.querySelector('.update-components-actor__title span[aria-hidden="true"], .feed-shared-actor__title span');
    if (nameSpan) return nameSpan.textContent?.trim() || undefined;
    return undefined;
  }

  // Twitter/X
  const userLinks = tweetElement.querySelectorAll('a[href^="/"]');
  for (const link of userLinks) {
    const href = link.getAttribute("href");
    if (href && href.match(/^\/[a-zA-Z0-9_]+$/) && !href.includes("/status/")) {
      return href.slice(1);
    }
  }

  const handleSpan = tweetElement.querySelector(
    'div[data-testid="User-Name"] a[role="link"]'
  );
  if (handleSpan) {
    const href = handleSpan.getAttribute("href");
    if (href) return href.slice(1);
  }

  return undefined;
}

function extractAuthorLocation(tweetElement: HTMLElement): string | undefined {
  const userNameDiv = tweetElement.querySelector('div[data-testid="User-Name"]');
  if (!userNameDiv) return undefined;

  const allSpans = tweetElement.querySelectorAll('span');
  for (const span of allSpans) {
    const text = span.textContent || "";
    if (span.closest('[data-testid="UserLocation"]') ||
        span.closest('[data-testid="userLocation"]')) {
      return text.trim();
    }
  }

  return undefined;
}

function findParentTweet(tweetElement: HTMLElement): string | undefined {
  let cursor: HTMLElement | null = tweetElement;

  while (cursor && cursor !== document.body) {
    let prev = cursor.previousElementSibling as HTMLElement | null;
    while (prev) {
      const article = prev.matches('article[data-testid="tweet"]')
        ? prev
        : (prev.querySelector('article[data-testid="tweet"]') as HTMLElement | null);
      const text = clampText(article?.querySelector('[data-testid="tweetText"]')?.textContent, 700);
      if (text) {
        return text;
      }
      prev = prev.previousElementSibling as HTMLElement | null;
    }

    cursor = cursor.parentElement;
  }

  return undefined;
}

function normalizeExtractedText(value?: string | null): string {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function clampText(value?: string | null, maxLength: number = 1000): string {
  return normalizeExtractedText(value).slice(0, maxLength);
}

function isUsefulImageAlt(alt: string): boolean {
  const normalized = normalizeExtractedText(alt).toLowerCase();
  if (!normalized) return false;

  const genericValues = new Set([
    "image",
    "gif",
    "emoji",
    "opens profile photo",
    "profile photo",
    "embedded video",
    "video",
  ]);

  return !genericValues.has(normalized);
}

function extractQuotedTweetText(tweetElement: HTMLElement): string | undefined {
  const quoted = tweetElement.querySelector('[data-testid="quoteTweet"] [data-testid="tweetText"]');
  return clampText(quoted?.textContent, 500) || undefined;
}

function detectReply(tweetElement: HTMLElement, context?: string): boolean {
  if (Boolean(context)) return true;

  return Array.from(tweetElement.querySelectorAll("span")).some((span) =>
    normalizeExtractedText(span.textContent).startsWith("Replying to")
  );
}

function extractMediaSummary(postElement: HTMLElement): string | undefined {
  const platform = getCurrentPlatform();
  const imageSelectors =
    platform === "linkedin"
      ? [
          ".update-components-image img",
          ".update-components-linkedin-image img",
          'img[src*="media.licdn.com"]',
        ]
      : [
          '[data-testid="tweetPhoto"] img',
          'a[href*="/photo/"] img',
          'img[src*="pbs.twimg.com/media"]',
        ];
  const videoSelectors =
    platform === "linkedin"
      ? ["video", ".update-components-linkedin-video"]
      : ["video", '[data-testid="videoPlayer"]'];

  const images = Array.from(
    new Set(
      imageSelectors.flatMap((selector) =>
        Array.from(postElement.querySelectorAll(selector))
      )
    )
  ) as HTMLImageElement[];
  const videos = Array.from(
    new Set(
      videoSelectors.flatMap((selector) =>
        Array.from(postElement.querySelectorAll(selector))
      )
    )
  );
  const hasGif = Array.from(postElement.querySelectorAll("span, div")).some((node) =>
    normalizeExtractedText(node.textContent).includes("gif")
  );

  const altText = images
    .map((img) => img.alt)
    .filter(isUsefulImageAlt)
    .slice(0, 3)
    .map((alt) => clampText(alt, 160));

  const parts: string[] = [];

  if (images.length > 0) {
    parts.push(`${images.length} image${images.length === 1 ? "" : "s"}`);
  }

  if (videos.length > 0) {
    parts.push(`${videos.length} video${videos.length === 1 ? "" : "s"}`);
  }

  if (hasGif) {
    parts.push("GIF media");
  }

  if (altText.length > 0) {
    parts.push(`image alt text: ${altText.join(" | ")}`);
  }

  return parts.length > 0 ? parts.join(". ") : undefined;
}

function isDarkMode(): boolean {
  const bgColor = document.documentElement.style.getPropertyValue("--background-color") ||
    window.getComputedStyle(document.body).backgroundColor;

  if (bgColor) {
    const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const luminance = (parseInt(match[1]) * 299 + parseInt(match[2]) * 587 + parseInt(match[3]) * 114) / 1000;
      return luminance < 128;
    }
  }

  const colorScheme = document.querySelector('html')?.getAttribute('style') || "";
  if (colorScheme.includes('color-scheme: dark')) return true;

  const bodyBg = window.getComputedStyle(document.body).backgroundColor;
  if (bodyBg === "rgb(0, 0, 0)" || bodyBg === "rgb(21, 32, 43)") return true;

  return false;
}

function applyDetectionMode(
  element: HTMLElement,
  probability: number,
  reason: string,
  label: string,
  mode: DetectionMode
) {
  // Store metadata on element for re-application
  element.setAttribute('data-nmb-filtered', 'true');
  element.setAttribute('data-nmb-probability', String(probability));
  element.setAttribute('data-nmb-reason', reason || "");
  element.setAttribute('data-nmb-label', label || "");

  const dark = isDarkMode();
  switch (mode) {
    case "blur":
      applyBlurMode(element, probability, label, dark);
      break;
    case "hide":
      applyHideMode(element);
      break;
    case "label":
      applyLabelMode(element, probability, reason, label, dark);
      break;
  }
}

function applyBlurMode(
  element: HTMLElement,
  probability: number,
  label: string,
  dark: boolean
) {
  element.style.filter = "blur(8px)";
  element.style.transition = "filter 0.3s ease";
  element.style.position = "relative";

  const badge = document.createElement("div");
  badge.setAttribute('data-nmb-mode', 'blur');
  Object.assign(badge.style, {
    position: "absolute",
    top: "8px",
    right: "8px",
    zIndex: "1001",
    background: dark ? "rgba(139, 92, 246, 0.9)" : "rgba(124, 58, 237, 0.9)",
    color: "#fff",
    padding: "4px 10px",
    borderRadius: "9999px",
    fontSize: "11px",
    fontWeight: "600",
    cursor: "pointer",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  });

  const iconText = label === "geo_blocked" ? "🌍" : "🤖";
  const labelText = getLabelShortText(label);

  badge.innerHTML = `<span>${iconText}</span><span>${labelText} · ${Math.round(probability * 100)}%</span>`;

  // Click to reveal
  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    element.style.filter = "none";
    badge.innerHTML = `<span>👁</span><span>Revealed</span>`;
    badge.style.background = dark ? "rgba(100, 100, 100, 0.7)" : "rgba(150, 150, 150, 0.7)";
    // Click again to re-blur
    const reblur = () => {
      element.style.filter = "blur(8px)";
      badge.innerHTML = `<span>${iconText}</span><span>${labelText} · ${Math.round(probability * 100)}%</span>`;
      badge.style.background = dark ? "rgba(139, 92, 246, 0.9)" : "rgba(124, 58, 237, 0.9)";
      badge.removeEventListener("click", reblur);
      badge.addEventListener("click", (e2) => {
        e2.stopPropagation();
        element.style.filter = "none";
        badge.innerHTML = `<span>👁</span><span>Revealed</span>`;
        badge.style.background = dark ? "rgba(100, 100, 100, 0.7)" : "rgba(150, 150, 150, 0.7)";
      }, { once: true });
    };
    setTimeout(() => {
      badge.addEventListener("click", reblur, { once: true });
    }, 100);
  }, { once: true });

  element.appendChild(badge);
}

function applyHideMode(element: HTMLElement) {
  const wrapper = document.createElement("div");
  wrapper.setAttribute('data-nmb-mode', 'hide');

  const dark = isDarkMode();
  const borderColor = dark ? "#38444d" : "#e1e8ed";
  const textColor = dark ? "#8B98A5" : "#536471";

  Object.assign(wrapper.style, {
    padding: "12px 16px",
    borderBottom: `1px solid ${borderColor}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    cursor: "pointer",
  });

  wrapper.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;color:${textColor};font-size:13px;">
      <span>🤖</span>
      <span>AI content hidden</span>
    </div>
    <span style="color:${textColor};font-size:12px;opacity:0.6;">Click to show</span>
  `;

  // Hide the original element
  element.style.display = "none";
  element.parentElement?.insertBefore(wrapper, element);

  wrapper.addEventListener("click", () => {
    element.style.display = "";
    wrapper.remove();
    element.removeAttribute('data-nmb-filtered');
  });
}

function applyLabelMode(
  element: HTMLElement,
  probability: number,
  reason: string,
  label: string,
  dark: boolean
) {
  element.style.position = "relative";

  const banner = document.createElement("div");
  banner.setAttribute('data-nmb-mode', 'label');

  const bgColor = dark ? "rgba(139, 92, 246, 0.15)" : "rgba(124, 58, 237, 0.08)";
  const accentColor = dark ? "#a78bfa" : "#7c3aed";

  Object.assign(banner.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 12px",
    background: bgColor,
    borderLeft: `3px solid ${accentColor}`,
    borderRadius: "0 6px 6px 0",
    marginBottom: "4px",
    fontSize: "11px",
    color: accentColor,
    fontWeight: "500",
  });

  const iconText = label === "geo_blocked" ? "🌍" : "🤖";
  const labelText = getLabelShortText(label);

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;">
      <span>${iconText}</span>
      <span>${labelText}</span>
      <span style="opacity:0.6;">· ${Math.round(probability * 100)}% confidence</span>
    </div>
    ${reason ? `<span style="opacity:0.5;font-size:10px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${reason}">${reason}</span>` : ""}
  `;

  // Insert banner at top of tweet
  element.insertBefore(banner, element.firstChild);
}

function getLabelShortText(label: string): string {
  switch (label) {
    case "geo_blocked": return "Geo-Blocked";
    case "engagement": return "Engagement Farm";
    case "ragebait": return "Ragebait";
    case "hate_speech": return "Hate Speech";
    case "racism": return "Racism";
    case "vague_posting": return "Vague Post";
    case "fearmongering": return "Fearmongering";
    case "ai": return "AI Content";
    default: return "AI Detected";
  }
}

function addToHistory(
  tweetId: string,
  authorHandle: string,
  text: string,
  label: string,
  reason: string,
  confidence: number
) {
  const historyLimit = settingsCache?.planFeatures.historyLimit || PLAN_DEFINITIONS[DEFAULT_PLAN_ID].features.historyLimit;
  const entry = {
    tweetId,
    authorHandle,
    text: text.substring(0, 200),
    label,
    reason,
    confidence,
    timestamp: Date.now(),
    url: window.location.href,
  };

  historyLog.unshift(entry);
  if (historyLog.length > historyLimit) {
    historyLog = historyLog.slice(0, historyLimit);
  }

  // Persist to storage
  chrome.storage.local.set({ history: historyLog });
}

function rememberProcessedTweet(tweetId: string) {
  if (processedTweets.has(tweetId)) {
    return;
  }

  processedTweets.add(tweetId);
  processedTweetOrder.push(tweetId);

  while (processedTweetOrder.length > MAX_TRACKED_TWEETS) {
    const oldestTweetId = processedTweetOrder.shift();
    if (oldestTweetId) {
      processedTweets.delete(oldestTweetId);
    }
  }
}

async function flushQueue() {
  if (tweetQueue.length === 0) return;

  const settings = settingsCache || await loadSettings();

  // Check platform activation
  const platform = getCurrentPlatform();
  if (platform === "twitter" && !settings.activeOnTwitter) return;
  if (platform === "linkedin" && !settings.activeOnLinkedin) return;

  const batch = [...tweetQueue];
  tweetQueue = [];

  const batchIds = new Set(batch.map((t) => t.id));
  batchIds.forEach((id) => inFlightTweets.add(id));

  if (settings.enabled === false) {
    batchIds.forEach((id) => inFlightTweets.delete(id));
    return;
  }

  if (!settings.userId) {
    batchIds.forEach((id) => inFlightTweets.delete(id));
    return;
  }

  try {
    const response = await sendClassificationRequest(batch, settings);

    batchIds.forEach((id) => inFlightTweets.delete(id));

    if (!response.success) {
      handleClassificationError(response, batch);
      return;
    }

    chrome.storage.local.set({ limitReached: false });

    if (response.data?.results) {
      processClassificationResults(response.data.results, batch, settings);
    }

    await updateStats(batch.length, 0);

  } catch (error) {
    batchIds.forEach((id) => inFlightTweets.delete(id));
    console.error("Batch classification error:", error);
    retryFailedItems(batch);
  }
}

async function sendClassificationRequest(
  batch: typeof tweetQueue,
  settings: typeof settingsCache
) {
  return new Promise<{ success: boolean; data?: any; error?: string; status?: number }>(
    (resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "CLASSIFY_TWEETS",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": settings?.userId || "anonymous",
            "x-api-key": settings?.userApiKey || "",
            "x-provider": settings?.provider || "gemini",
          },
        body: {
          tweets: batch.map((t) => ({
            id: t.id,
            text: t.text,
            authorHandle: t.authorHandle,
            context: t.context,
            quotedText: t.quotedText,
            mediaSummary: t.mediaSummary,
            isReply: t.isReply,
            platform: getCurrentPlatform() as SupportedPlatform,
          })),
        },
      },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { success: false, error: "No response" });
        }
      );
    }
  );
}

function handleClassificationError(
  response: { success: boolean; error?: string; status?: number },
  batch: typeof tweetQueue
) {
  if (response.status === 402) {
    chrome.storage.local.set({ limitReached: true });
  } else if (response.status === 429) {
    retryFailedItems(batch);
  } else {
    if (response.status && response.status >= 400 && response.status < 500 && response.status !== 429) {
      return;
    }
    retryFailedItems(batch);
  }
}

function processClassificationResults(
  results: TweetClassification[],
  batch: typeof tweetQueue,
  settings: typeof settingsCache
) {
  let hiddenCount = 0;
  const mode = settings?.detectionMode || "blur";

  results.forEach((result: TweetClassification) => {
    rememberProcessedTweet(result.tweetId);
    const item = batch.find((b) => b.id === result.tweetId);
    if (item && result.aiProbability > (settings?.threshold || 0.75)) {
      applyDetectionMode(item.element, result.aiProbability, result.reason, result.label, mode);
      const historyText =
        item.text ||
        item.mediaSummary ||
        item.quotedText ||
        item.context ||
        (item.isReply ? "[Reply with no visible text]" : "[Media post with no visible text]");
      addToHistory(result.tweetId, item.authorHandle, historyText, result.label, result.reason, result.aiProbability);
      hiddenCount++;
      pageHiddenCount++;
    }
  });

  if (hiddenCount > 0) {
    updateStats(0, hiddenCount);
    // Notify popup of page stats update
    chrome.runtime.sendMessage({ type: "PAGE_STATS_UPDATED", pageHidden: pageHiddenCount }).catch(() => {});
  }
}

async function updateStats(scanned: number, hidden: number) {
  try {
    const result = await chrome.storage.local.get(["stats"]);
    const stats = result.stats || { scanned: 0, hidden: 0, todayHidden: 0, todayDate: "" };

    stats.scanned += scanned;
    stats.hidden += hidden;

    // Track today's count
    const today = new Date().toDateString();
    if (stats.todayDate !== today) {
      stats.todayHidden = 0;
      stats.todayDate = today;
    }
    stats.todayHidden += hidden;

    await chrome.storage.local.set({ stats });
  } catch (error) {
    console.error("Error updating stats:", error);
  }
}

function retryFailedItems(batch: typeof tweetQueue) {
  const retryable = batch
    .map(item => ({ ...item, retries: item.retries + 1 }))
    .filter(item => item.retries < MAX_RETRIES);

  if (retryable.length > 0) {
    setTimeout(() => {
      tweetQueue.push(...retryable);
      scheduleFlush();
    }, 2000 * Math.pow(2, retryable[0].retries));
  }
}

function scheduleFlush() {
  clearTimeout(flushTimeout);
  flushTimeout = setTimeout(flushQueue, FLUSH_DELAY);
}

function processTwitterNode(element: HTMLElement) {
  const tweets_list: HTMLElement[] = [];

  if (element.matches('[data-testid="tweet"]')) {
    tweets_list.push(element);
  }
  element.querySelectorAll('[data-testid="tweet"]').forEach((t) => {
    if (!tweets_list.includes(t as HTMLElement)) {
      tweets_list.push(t as HTMLElement);
    }
  });

  if (tweets_list.length === 0) {
    const textNodes = element.querySelectorAll('[data-testid="tweetText"]');
    textNodes.forEach((textNode) => {
      const container = textNode.closest("article");
      if (container && !tweets_list.includes(container as HTMLElement)) {
        tweets_list.push(container as HTMLElement);
      }
    });
  }

  tweets_list.forEach((tweetElement) => {
    const link = tweetElement.querySelector('a[href*="/status/"]');
    if (!link) return;

    const isPromoted = Array.from(tweetElement.querySelectorAll("span")).some(
      (span) => span.textContent === "Ad" || span.textContent === "Promoted"
    );
    if (isPromoted) return;

    const href = link.getAttribute("href");
    const tweetId = href?.split("/status/")[1]?.split("?")[0];

    if (!tweetId) return;
    if (processedTweets.has(tweetId) || inFlightTweets.has(tweetId)) return;

    const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
    const text = clampText(textElement?.textContent);
    const context = clampText(findParentTweet(tweetElement), 700) || undefined;
    const quotedText = extractQuotedTweetText(tweetElement);
    const mediaSummary = extractMediaSummary(tweetElement);
    const isReply = detectReply(tweetElement, context);

    if (!text && !quotedText && !mediaSummary) return;

    inFlightTweets.add(tweetId);

    const authorHandle = extractAuthorHandle(tweetElement) || "unknown";
    const authorLocation = extractAuthorLocation(tweetElement);

    tweetQueue.push({
      id: tweetId,
      text,
      element: tweetElement,
      authorHandle,
      authorLocation,
      context,
      quotedText,
      mediaSummary,
      isReply,
      retries: 0,
    });

    scheduleFlush();
    if (tweetQueue.length >= BATCH_SIZE) {
      flushQueue();
    }
  });
}

function processLinkedInNode(element: HTMLElement) {
  // LinkedIn post selectors
  const posts: HTMLElement[] = [];

  const selectors = [
    '.feed-shared-update-v2',
    '.occludable-update',
    '[data-urn*="activity"]',
  ];

  for (const sel of selectors) {
    if (element.matches(sel)) {
      posts.push(element);
    }
    element.querySelectorAll(sel).forEach((p) => {
      if (!posts.includes(p as HTMLElement)) {
        posts.push(p as HTMLElement);
      }
    });
  }

  posts.forEach((postElement) => {
    // Generate a stable ID from the data-urn or content hash
    const urn = postElement.getAttribute('data-urn') || "";
    const postId = urn || `li-${hashCode(postElement.textContent || "")}`;

    if (!postId || processedTweets.has(postId) || inFlightTweets.has(postId)) return;

    // Extract text content
    const textContainer = postElement.querySelector('.feed-shared-text, .update-components-text, .break-words');
    const text = clampText(textContainer?.textContent);
    const mediaSummary = extractMediaSummary(postElement);
    if ((!text || text.length < 20) && !mediaSummary) return;

    // Check for sponsored/promoted
    const isSponsored = Array.from(postElement.querySelectorAll('span')).some(
      (span) => span.textContent?.includes("Promoted") || span.textContent?.includes("Sponsored")
    );
    if (isSponsored) return;

    inFlightTweets.add(postId);

    const authorHandle = extractAuthorHandle(postElement) || "unknown";

    tweetQueue.push({
      id: postId,
      text,
      element: postElement,
      authorHandle,
      mediaSummary,
      retries: 0,
    });

    scheduleFlush();
    if (tweetQueue.length >= BATCH_SIZE) {
      flushQueue();
    }
  });
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function processNode(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as HTMLElement;

  const platform = getCurrentPlatform();
  if (platform === "twitter") {
    if (!settingsCache?.activeOnTwitter) return;
    processTwitterNode(element);
  } else if (platform === "linkedin") {
    if (!settingsCache?.activeOnLinkedin || !settingsCache?.planFeatures.linkedinScanning) return;
    processLinkedInNode(element);
  }
}

// MutationObserver to watch for new posts
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach(processNode);
  });
});

// Initialize
async function init() {
  await loadSettings();

  const platform = getCurrentPlatform();
  if (platform === "unknown") {
    console.log("NoMoreBots: Not on a supported platform, skipping");
    return;
  }

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  processNode(document.body);

  console.log(`NoMoreBots: Initialized on ${platform}`);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.addEventListener("beforeunload", () => {
  observer.disconnect();
  clearTimeout(flushTimeout);
});
