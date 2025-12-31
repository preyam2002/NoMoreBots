```
import { ClassificationResponse } from '../../../shared/types';

console.log('AI Tweet Filter: Content script loaded');

const API_URL = 'http://localhost:3000/api/classify';
let processedTweets = new Set<string>();
let tweetQueue: { id: string; text: string; element: HTMLElement; authorHandle: string; context?: string }[] = [];

// ...

function findParentTweet(tweetElement: HTMLElement): string | undefined {
  // Heuristic: In a thread, the parent tweet is often the preceding sibling article
  // or inside a preceding div.
  // This is brittle and depends on X's DOM.
  
  // Try to find a preceding sibling article
  let prev = tweetElement.previousElementSibling;
  while (prev) {
    if (prev.tagName === 'ARTICLE' && prev.getAttribute('data-testid') === 'tweet') {
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
    const settings = await chrome.storage.local.get(['enabled', 'threshold', 'userId', 'userApiKey']);
    if (settings.enabled === false) return;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-user-id': settings.userId || 'anonymous',
        'x-openai-key': settings.userApiKey || ''
      },
      body: JSON.stringify({
        tweets: batch.map(t => ({
          id: t.id,
          text: t.text,
          authorHandle: t.authorHandle,
          context: t.context
        }))
      })
    });
    // ... rest of flushQueue


    if (response.status === 402) {
      console.warn('Payment required: Daily limit reached');
      await chrome.storage.local.set({ limitReached: true });
      return; // Stop processing
    } else {
      await chrome.storage.local.set({ limitReached: false });
    }

    if (!response.ok) {
      console.error('API Error:', response.statusText);
      return;
    }

    const data = await response.json();
    
    // Process results
    if (data.results) {
      data.results.forEach((result: any) => {
        const item = batch.find(b => b.id === result.tweetId);
        if (item && result.aiProbability > (settings.threshold || 0.75)) {
          hideTweet(item.element, result.aiProbability);
          
          // Update stats
          chrome.storage.local.get(['stats'], (res) => {
            const stats = res.stats || { scanned: 0, hidden: 0 };
            stats.hidden++;
            chrome.storage.local.set({ stats });
          });
        }
      });
    }

    // Update scanned stats
    chrome.storage.local.get(['stats'], (res) => {
      const stats = res.stats || { scanned: 0, hidden: 0 };
      stats.scanned += batch.length;
      chrome.storage.local.set({ stats });
    });

  } catch (error) {
    console.error('Batch classification error:', error);
  }
}

function hideTweet(element: HTMLElement, probability: number) {
  // Create overlay
  // Create overlay
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    background: 'rgba(255, 255, 255, 0.95)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '10',
    backdropFilter: 'blur(4px)',
    borderRadius: '12px',
  });
  
  const container = document.createElement('div');
  container.style.textAlign = 'center';
  container.style.color = '#536471';

  const icon = document.createElement('div');
  icon.textContent = '🤖';
  icon.style.fontSize = '24px';
  icon.style.marginBottom = '8px';
  container.appendChild(icon);

  const title = document.createElement('div');
  title.textContent = 'AI Content Detected';
  title.style.fontWeight = '600';
  title.style.marginBottom = '4px';
  container.appendChild(title);

  const prob = document.createElement('div');
  prob.textContent = `Probability: ${Math.round(probability * 100)}%`;
  prob.style.fontSize = '12px';
  prob.style.opacity = '0.8';
  container.appendChild(prob);

  const btn = document.createElement('button');
  btn.textContent = 'Show Tweet';
  Object.assign(btn.style, {
    marginTop: '12px',
    background: 'transparent',
    border: '1px solid #536471',
    borderRadius: '9999px',
    padding: '6px 16px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    color: '#536471',
  });
  container.appendChild(btn);

  overlay.appendChild(container);

  // Hide original content but keep layout
  const originalDisplay = element.style.display;
  
  // Insert overlay
  if (element.style.position !== 'absolute' && element.style.position !== 'fixed') {
    element.style.position = 'relative';
  }
  element.appendChild(overlay);

  // Click handler to reveal
  const btn = overlay.querySelector('button');
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.remove();
  });
}

// Debounce utility
function debounce(func: Function, wait: number) {
  let timeout: any;
  return function executedFunction(...args: any[]) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function processNode(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as HTMLElement;
  
  const tweets = element.querySelectorAll('article[data-testid="tweet"]');
  
  tweets.forEach((tweetElement) => {
    const link = tweetElement.querySelector('a[href*="/status/"]');
    if (!link) return;
    
    const href = link.getAttribute('href');
    const tweetId = href?.split('/status/')[1]?.split('?')[0];
    
    if (!tweetId || processedTweets.has(tweetId)) return;
    
    processedTweets.add(tweetId);
    
    const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
    const text = textElement?.textContent || '';
    if (!text) return;

    const authorHandle = extractAuthorHandle(tweetElement as HTMLElement) || 'unknown';
    const context = findParentTweet(tweetElement as HTMLElement);

    // Add to queue
    tweetQueue.push({
      id: tweetId,
      text: text,
      element: tweetElement as HTMLElement,
      authorHandle,
      context
    });

    // Schedule flush
    clearTimeout(flushTimeout);
    flushTimeout = setTimeout(flushQueue, 1000); // Flush every 1s of inactivity, or max size?
    
    // Also flush if queue gets too big
    if (tweetQueue.length >= 10) {
      flushQueue();
    }
  });
}

const handleMutations = debounce((mutations: MutationRecord[]) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach(processNode);
  });
}, 500);

const observer = new MutationObserver(handleMutations);

// Start observing
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Process initial load
processNode(document.body);
```
