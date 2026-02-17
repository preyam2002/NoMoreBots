import { TweetClassification } from "../../../shared/types";

console.log("NoMoreBots: Content script loaded");

// State management
let processedTweets = new Set<string>();
let inFlightTweets = new Set<string>();
let tweetQueue: {
  id: string;
  text: string;
  element: HTMLElement;
  authorHandle: string;
  context?: string;
  retries: number;
}[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | undefined;
const MAX_RETRIES = 3;
const BATCH_SIZE = 10;
const FLUSH_DELAY = 800; // ms

// Settings cache
let settingsCache: {
  enabled: boolean;
  threshold: number;
  userId: string;
  userApiKey: string;
  provider: string;
} | null = null;

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get([
      "enabled",
      "threshold",
      "userId",
      "userApiKey",
      "provider"
    ]);
    
    settingsCache = {
      enabled: result.enabled !== false, // default true
      threshold: result.threshold || 0.75,
      userId: result.userId || "",
      userApiKey: result.userApiKey || "",
      provider: result.provider || "gemini",
    };
    
    return settingsCache;
  } catch (error) {
    console.error("Error loading settings:", error);
    return {
      enabled: true,
      threshold: 0.75,
      userId: "",
      userApiKey: "",
      provider: "gemini",
    };
  }
}

// Listen for settings changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled || changes.threshold || changes.userApiKey || changes.provider) {
    loadSettings();
  }
});

function extractAuthorHandle(tweetElement: HTMLElement): string | undefined {
  // Try to find the author handle from the tweet
  const userLinks = tweetElement.querySelectorAll('a[href^="/"]');
  for (const link of userLinks) {
    const href = link.getAttribute("href");
    if (href && href.match(/^\/[a-zA-Z0-9_]+$/) && !href.includes("/status/")) {
      return href.slice(1); // Remove leading /
    }
  }

  // Fallback: try to find from data attributes
  const handleSpan = tweetElement.querySelector(
    'div[data-testid="User-Name"] a[role="link"]'
  );
  if (handleSpan) {
    const href = handleSpan.getAttribute("href");
    if (href) {
      return href.slice(1);
    }
  }

  return undefined;
}

function findParentTweet(tweetElement: HTMLElement): string | undefined {
  // Find a preceding sibling article (for threads)
  let prev = tweetElement.previousElementSibling;
  while (prev) {
    if (
      prev.tagName === "ARTICLE" &&
      prev.getAttribute("data-testid") === "tweet"
    ) {
      const textEl = prev.querySelector('div[data-testid="tweetText"]');
      return textEl?.textContent || undefined;
    }
    prev = prev.previousElementSibling;
  }
  return undefined;
}

async function flushQueue() {
  if (tweetQueue.length === 0) return;

  const batch = [...tweetQueue];
  tweetQueue = []; // Clear queue immediately

  const batchIds = new Set(batch.map((t) => t.id));
  batchIds.forEach((id) => inFlightTweets.add(id));

  const settings = settingsCache || await loadSettings();
  
  if (settings.enabled === false) {
    console.log("NoMoreBots: Filter disabled, skipping batch");
    batchIds.forEach((id) => inFlightTweets.delete(id));
    return;
  }

  if (!settings.userId) {
    console.warn("NoMoreBots: No userId found, skipping classification");
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

    // Success - clear limit flag
    chrome.storage.local.set({ limitReached: false });
    
    // Process results
    if (response.data?.results) {
      processClassificationResults(response.data.results, batch, settings);
    }

    // Update scanned stats
    await updateStats(batch.length, 0);
    
  } catch (error) {
    batchIds.forEach((id) => inFlightTweets.delete(id));
    console.error("Batch classification error:", error);
    // Retry failed items
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
            })),
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: chrome.runtime.lastError.message,
            });
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
    console.warn("NoMoreBots: Payment required - Daily limit reached");
    chrome.storage.local.set({ limitReached: true });
  } else if (response.status === 429) {
    console.warn("NoMoreBots: Rate limited, retrying...");
    retryFailedItems(batch);
  } else {
    console.error("NoMoreBots: API Error:", response.error);
    // Don't retry on client errors (4xx except 429)
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

  results.forEach((result: TweetClassification) => {
    processedTweets.add(result.tweetId);
    const item = batch.find((b) => b.id === result.tweetId);
    if (item && result.aiProbability > (settings?.threshold || 0.75)) {
      hideTweet(item.element, result.aiProbability, result.reason);
      hiddenCount++;
    }
  });

  if (hiddenCount > 0) {
    updateStats(0, hiddenCount);
  }
}

async function updateStats(scanned: number, hidden: number) {
  try {
    const result = await chrome.storage.local.get(["stats"]);
    const stats = result.stats || { scanned: 0, hidden: 0 };
    stats.scanned += scanned;
    stats.hidden += hidden;
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
    console.log(`NoMoreBots: Retrying ${retryable.length} items`);
    // Add back to queue with exponential backoff
    setTimeout(() => {
      tweetQueue.push(...retryable);
      scheduleFlush();
    }, 2000 * Math.pow(2, retryable[0].retries));
  }
}

function hideTweet(element: HTMLElement, probability: number, reason?: string) {
  // Check if already hidden
  if (element.querySelector('.ai-filter-overlay')) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = 'ai-filter-overlay';
  Object.assign(overlay.style, {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    background: "rgba(255, 255, 255, 0.97)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "1000",
    backdropFilter: "blur(4px)",
    borderRadius: "12px",
    cursor: "pointer",
  });

  const container = document.createElement("div");
  container.style.textAlign = "center";
  container.style.color = "#536471";
  container.style.padding = "16px";

  const icon = document.createElement("div");
  icon.textContent = "🤖";
  icon.style.fontSize = "28px";
  icon.style.marginBottom = "8px";
  container.appendChild(icon);

  const title = document.createElement("div");
  title.textContent = "AI Content Hidden";
  title.style.fontWeight = "600";
  title.style.marginBottom = "4px";
  title.style.fontSize = "14px";
  container.appendChild(title);

  const prob = document.createElement("div");
  prob.textContent = `${Math.round(probability * 100)}% confidence`;
  prob.style.fontSize = "11px";
  prob.style.opacity = "0.7";
  container.appendChild(prob);

  if (reason) {
    const reasonEl = document.createElement("div");
    reasonEl.textContent = reason.length > 50 ? reason.substring(0, 50) + "..." : reason;
    reasonEl.style.fontSize = "10px";
    reasonEl.style.marginTop = "4px";
    reasonEl.style.opacity = "0.6";
    reasonEl.style.fontStyle = "italic";
    container.appendChild(reasonEl);
  }

  const showBtn = document.createElement("button");
  showBtn.textContent = "Show";
  Object.assign(showBtn.style, {
    marginTop: "12px",
    background: "transparent",
    border: "1px solid #536471",
    borderRadius: "9999px",
    padding: "6px 16px",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    color: "#536471",
    transition: "all 0.2s",
  });
  showBtn.onmouseenter = () => {
    showBtn.style.background = "#536471";
    showBtn.style.color = "white";
  };
  showBtn.onmouseleave = () => {
    showBtn.style.background = "transparent";
    showBtn.style.color = "#536471";
  };
  container.appendChild(showBtn);

  overlay.appendChild(container);

  // Ensure position context
  const computedStyle = window.getComputedStyle(element);
  if (computedStyle.position === "static") {
    element.style.position = "relative";
  }
  
  element.appendChild(overlay);

  // Click handler to reveal
  showBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    overlay.remove();
  });

  // Also allow clicking overlay to show
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      e.stopPropagation();
      overlay.remove();
    }
  });
}

function scheduleFlush() {
  clearTimeout(flushTimeout);
  flushTimeout = setTimeout(flushQueue, FLUSH_DELAY);
}

function processNode(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as HTMLElement;

  // Check if the element itself is a tweet, or contains tweets
  const tweets_list: HTMLElement[] = [];

  // Standard Selector
  if (element.matches('[data-testid="tweet"]')) {
    tweets_list.push(element);
  }
  element.querySelectorAll('[data-testid="tweet"]').forEach((t) => {
    if (!tweets_list.includes(t as HTMLElement)) {
      tweets_list.push(t as HTMLElement);
    }
  });

  // Fallback: Look for tweetText if standard selector fails
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

    // Check for Promoted/Ad indicators
    const isPromoted = Array.from(tweetElement.querySelectorAll("span")).some(
      (span) => span.textContent === "Ad" || span.textContent === "Promoted"
    );

    if (isPromoted) return;

    const href = link.getAttribute("href");
    const tweetId = href?.split("/status/")[1]?.split("?")[0];

    if (!tweetId) return;
    if (processedTweets.has(tweetId) || inFlightTweets.has(tweetId)) return;

    inFlightTweets.add(tweetId);

    const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
    const text = textElement?.textContent || "";
    if (!text) return;

    const authorHandle = extractAuthorHandle(tweetElement) || "unknown";
    const context = findParentTweet(tweetElement);

    // Add to queue
    tweetQueue.push({
      id: tweetId,
      text: text,
      element: tweetElement,
      authorHandle,
      context,
      retries: 0,
    });

    // Schedule flush
    scheduleFlush();

    // Flush immediately if queue is full
    if (tweetQueue.length >= BATCH_SIZE) {
      flushQueue();
    }
  });
}

// MutationObserver to watch for new tweets
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach(processNode);
  });
});

// Initialize
async function init() {
  await loadSettings();
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Process initial load
  processNode(document.body);
  
  console.log("NoMoreBots: Initialized and watching for tweets");
}

// Run init
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  observer.disconnect();
  clearTimeout(flushTimeout);
});
