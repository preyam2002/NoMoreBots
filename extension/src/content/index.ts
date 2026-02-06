import { TweetClassification } from "../../../shared/types";

console.log("AI Tweet Filter: Content script loaded");

let processedTweets = new Set<string>();
let tweetQueue: {
  id: string;
  text: string;
  element: HTMLElement;
  authorHandle: string;
  context?: string;
}[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | undefined;

function extractAuthorHandle(tweetElement: HTMLElement): string | undefined {
  // Try to find the author handle from the tweet
  // Look for the link that contains the username (usually in format /@username)
  const userLinks = tweetElement.querySelectorAll('a[href^="/"]');
  for (const link of userLinks) {
    const href = link.getAttribute("href");
    if (href && href.match(/^\/[a-zA-Z0-9_]+$/) && !href.includes("/status/")) {
      return href.slice(1); // Remove leading /
    }
  }

  // Fallback: try to find from data attributes or other elements
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
  // Heuristic: In a thread, the parent tweet is often the preceding sibling article
  // or inside a preceding div.
  // This is brittle and depends on X's DOM.

  // Try to find a preceding sibling article
  let prev = tweetElement.previousElementSibling;
  while (prev) {
    if (
      prev.tagName === "ARTICLE" &&
      prev.getAttribute("data-testid") === "tweet"
    ) {
      const textEl = prev.querySelector('div[data-testid="tweetText"]');
      return textEl?.textContent || undefined;
    }
    // Sometimes there are connector lines (divs) between tweets
    prev = prev.previousElementSibling;
  }
  return undefined;
}

async function flushQueue() {
  if (tweetQueue.length === 0) return;

  const batch = [...tweetQueue];
  tweetQueue = []; // Clear queue immediately

  try {
    const settings = await chrome.storage.local.get([
      "enabled",
      "threshold",
      "userId",
      "userApiKey",
    ]);
    if (settings.enabled === false) return;

    // Send to background script to proxy the request (Avoid Mixed Content Header)
    chrome.runtime.sendMessage(
      {
        type: "CLASSIFY_TWEETS",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": settings.userId || "anonymous",
          "x-openai-key": settings.userApiKey || "",
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
          console.error("Runtime error:", chrome.runtime.lastError);
          return;
        }

        if (!response || !response.success) {
          if (response?.status === 402) {
            console.warn("Payment required: Daily limit reached");
            chrome.storage.local.set({ limitReached: true });
          } else {
            console.error("API Error via Background:", response?.error);
          }
          return;
        }

        // Success
        chrome.storage.local.set({ limitReached: false });
        const data = response.data;

        // Process results
        if (data.results) {
          data.results.forEach((result: TweetClassification) => {
            const item = batch.find((b) => b.id === result.tweetId);
            if (item && result.aiProbability > (settings.threshold || 0.75)) {
              hideTweet(item.element, result.aiProbability);

              // Update stats
              chrome.storage.local.get(["stats"], (res) => {
                const stats = res.stats || { scanned: 0, hidden: 0 };
                stats.hidden++;
                chrome.storage.local.set({ stats });
              });
            }
          });
        }

        // Update scanned stats
        chrome.storage.local.get(["stats"], (res) => {
          const stats = res.stats || { scanned: 0, hidden: 0 };
          stats.scanned += batch.length;
          chrome.storage.local.set({ stats });
        });
      }
    );

    // End of proxy logic, we handle response inside callback
    return;
  } catch (error) {
    console.error("Batch classification error:", error);
  }
}

function hideTweet(element: HTMLElement, probability: number) {
  // Create overlay
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    background: "rgba(255, 255, 255, 0.95)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "10",
    backdropFilter: "blur(4px)",
    borderRadius: "12px",
  });

  const container = document.createElement("div");
  container.style.textAlign = "center";
  container.style.color = "#536471";

  const icon = document.createElement("div");
  icon.textContent = "🤖";
  icon.style.fontSize = "24px";
  icon.style.marginBottom = "8px";
  container.appendChild(icon);

  const title = document.createElement("div");
  title.textContent = "AI Content Detected";
  title.style.fontWeight = "600";
  title.style.marginBottom = "4px";
  container.appendChild(title);

  const prob = document.createElement("div");
  prob.textContent = `Probability: ${Math.round(probability * 100)}%`;
  prob.style.fontSize = "12px";
  prob.style.opacity = "0.8";
  container.appendChild(prob);

  const showBtn = document.createElement("button");
  showBtn.textContent = "Show Tweet";
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
  });
  container.appendChild(showBtn);

  overlay.appendChild(container);

  // Insert overlay
  if (
    element.style.position !== "absolute" &&
    element.style.position !== "fixed"
  ) {
    element.style.position = "relative";
  }
  element.appendChild(overlay);

  // Click handler to reveal
  showBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    overlay.remove();
  });
}

function processNode(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as HTMLElement;

  // Check if the element itself is a tweet, or contains tweets
  const tweets_list: HTMLElement[] = [];

  // 1. Standard Selector
  if (element.matches('[data-testid="tweet"]')) {
    tweets_list.push(element);
  }
  element.querySelectorAll('[data-testid="tweet"]').forEach((t) => {
    tweets_list.push(t as HTMLElement);
  });

  // 2. Fallback: Look for tweetText if standard selector fails
  if (tweets_list.length === 0) {
    const textNodes = element.querySelectorAll('[data-testid="tweetText"]');
    textNodes.forEach((textNode) => {
      const container = textNode.closest("article");
      if (container && !tweets_list.includes(container as HTMLElement)) {
        tweets_list.push(container as HTMLElement);
      }
    });
  }

  if (tweets_list.length > 0) {
    console.log(
      `AI Tweet Filter: Found ${
        tweets_list.length
      } tweets (TagNames: ${tweets_list.map((t) => t.tagName).join(",")})`
    );
  }

  tweets_list.forEach((tweetElement) => {
    const link = tweetElement.querySelector('a[href*="/status/"]');
    if (!link) return;

    // Check for Promoted/Ad indicators
    const isPromoted = Array.from(tweetElement.querySelectorAll("span")).some(
      (span) => span.textContent === "Ad" || span.textContent === "Promoted"
    );

    if (isPromoted) {
      // console.log("Skipping promoted tweet");
      return;
    }

    const href = link.getAttribute("href");
    const tweetId = href?.split("/status/")[1]?.split("?")[0];

    if (!tweetId || processedTweets.has(tweetId)) return;

    processedTweets.add(tweetId);

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
    });

    // Schedule flush
    clearTimeout(flushTimeout);
    flushTimeout = setTimeout(flushQueue, 1000); // Flush every 1s of inactivity

    // Also flush if queue gets too big
    if (tweetQueue.length >= 10) {
      flushQueue();
    }
  });
}

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach(processNode);
  });
});

// Start observing
observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Process initial load
processNode(document.body);
