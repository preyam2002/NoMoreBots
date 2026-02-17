interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number = 100, ttlMs: number = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  set(key: string, data: T): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }
}

// Global cache instances
export const tweetCache = new LRUCache<{
  aiProbability: number;
  label: string;
  reason: string;
}>(1000, 24 * 60 * 60 * 1000); // 24 hours for tweet results

export const userCache = new LRUCache<{
  isPremium: boolean;
  requestCount: number;
  filterEngagement: boolean;
  filterRagebait: boolean;
  filterHateSpeech: boolean;
}>(1000, 5 * 60 * 1000); // 5 minutes for user settings

// Cleanup interval
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    tweetCache.cleanup();
    userCache.cleanup();
  }, 60 * 1000); // Every minute
}

export function generateCacheKey(...parts: (string | number)[]): string {
  return parts.join(":");
}
