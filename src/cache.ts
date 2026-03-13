/**
 * TTL-based in-memory cache for GitHub API responses and other expensive operations.
 * Reduces redundant API calls during bulk triage operations.
 */

import { CacheEntry } from './types.js';

export class TTLCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  set(key: string, value: T): void {
    this.store.set(key, {
      key,
      data: value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * Returns current number of non-expired entries.
   */
  size(): number {
    this.evictExpired();
    return this.store.size;
  }

  /**
   * Returns all non-expired keys.
   */
  keys(): string[] {
    this.evictExpired();
    return Array.from(this.store.keys());
  }

  /**
   * Get or compute a value, caching the result.
   */
  async getOrSet(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const value = await compute();
    this.set(key, value);
    return value;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

/** Shared caches for GitHub API responses */
export const issueCache = new TTLCache<unknown>(10 * 60 * 1000);   // 10 min
export const recentIssuesCache = new TTLCache<unknown>(5 * 60 * 1000); // 5 min
export const contributorsCache = new TTLCache<string[]>(30 * 60 * 1000); // 30 min
