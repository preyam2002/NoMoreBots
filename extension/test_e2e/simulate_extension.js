if (typeof window === "undefined") {
  console.error("Run this harness in a browser against extension/test_e2e/index.html, not directly with Node.");
  process.exit(1);
}

// Simulate Chrome API
window.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        // Mock settings
        const settings = {
          enabled: true,
          threshold: 0.6, // Lower threshold to ensure detection
          userId: 'test_user_e2e',
          userApiKey: ''
        };
        if (cb) cb(settings);
        return Promise.resolve(settings);
      },
      set: (obj) => Promise.resolve()
    }
  }
};

// Copy basic logic from content/index.ts (simplified)
const API_URL = 'http://localhost:3000/api/classify';

async function checkTweets() {
  console.log('Running scan...');
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  const batch = [];
  
  tweets.forEach(tweet => {
    // Check for Promoted/Ad indicators
    const isPromoted = Array.from(tweet.querySelectorAll("span")).some(
      (span) => span.textContent === "Ad" || span.textContent === "Promoted"
    );

    if (isPromoted) {
      console.log("Skipping promoted tweet in simulation");
      return;
    }

    const text = tweet.querySelector('[data-testid="tweetText"]')?.textContent;
    const href = tweet.querySelector('a[href^="/"]')?.getAttribute('href');
    const handle = href ? href.slice(1) : 'unknown';
    
    if (text) {
      batch.push({
        id: Math.random().toString(36), // One-time ID
        text,
        authorHandle: handle,
        element: tweet
      });
    }
  });

  if (batch.length === 0) return;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-user-id': 'test_user_e2e'
      },
      body: JSON.stringify({
        tweets: batch.map(t => ({
          id: t.id,
          text: t.text,
          authorHandle: t.authorHandle
        }))
      })
    });

    const data = await response.json();
    console.log('API Result:', data);

    if (data.results) {
      data.results.forEach(result => {
        if (result.aiProbability > 0.6) { // Matches mock threshold
          const batchItem = batch.find(b => b.id === result.tweetId);
          if (batchItem) {
             console.log(`Hiding tweet from ${batchItem.authorHandle} (Prob: ${result.aiProbability})`);
             hideTweet(batchItem.element, result.aiProbability);
          }
        }
      });
    }
  } catch (e) {
    console.error('API Error', e);
  }
}

function hideTweet(element, probability) {
  element.style.position = 'relative';
  element.style.border = '2px solid red'; // Visual indicator for test
  
  const overlay = document.createElement('div');
  overlay.id = 'ai-overlay'; // For verification
  overlay.innerHTML = `
    <div style="background:rgba(255,0,0,0.1); padding: 20px; text-align:center; font-weight:bold; color:red;">
       🤖 AI DETECTED (${Math.round(probability * 100)}%)
    </div>
  `;
  element.prepend(overlay);
}

// Run immediately
checkTweets();
