import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTLCache } from '../src/cache.js';

describe('TTLCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('stores and retrieves a value', () => {
    const cache = new TTLCache<string>(5000);
    cache.set('key1', 'hello');
    expect(cache.get('key1')).toBe('hello');
  });

  it('returns null for missing keys', () => {
    const cache = new TTLCache<string>(5000);
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('expires entries after TTL', () => {
    const cache = new TTLCache<string>(1000);
    cache.set('expiring', 'value');
    expect(cache.get('expiring')).toBe('value');

    vi.advanceTimersByTime(1001);
    expect(cache.get('expiring')).toBeNull();
  });

  it('has() returns false for expired entries', () => {
    const cache = new TTLCache<string>(500);
    cache.set('key', 'val');
    expect(cache.has('key')).toBe(true);

    vi.advanceTimersByTime(600);
    expect(cache.has('key')).toBe(false);
  });

  it('deletes entries manually', () => {
    const cache = new TTLCache<string>(5000);
    cache.set('toDelete', 'data');
    cache.delete('toDelete');
    expect(cache.get('toDelete')).toBeNull();
  });

  it('clears all entries', () => {
    const cache = new TTLCache<number>(5000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('size() excludes expired entries', () => {
    const cache = new TTLCache<string>(1000);
    cache.set('live', 'yes');
    cache.set('dying', 'no');

    vi.advanceTimersByTime(1001);
    cache.set('fresh', 'new');

    expect(cache.size()).toBe(1);
  });

  it('keys() returns only non-expired keys', () => {
    const cache = new TTLCache<string>(1000);
    cache.set('alive', 'yes');
    cache.set('dead', 'no');

    vi.advanceTimersByTime(500);
    cache.set('newborn', 'fresh');

    vi.advanceTimersByTime(600); // 'dead' and 'alive' expired
    const keys = cache.keys();
    expect(keys).toContain('newborn');
    expect(keys).not.toContain('alive');
    expect(keys).not.toContain('dead');
  });

  it('getOrSet computes and caches missing values', async () => {
    const cache = new TTLCache<number>(5000);
    const compute = vi.fn().mockResolvedValue(42);

    const result1 = await cache.getOrSet('computed', compute);
    const result2 = await cache.getOrSet('computed', compute);

    expect(result1).toBe(42);
    expect(result2).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1); // Only computed once
  });

  it('getOrSet recomputes after expiry', async () => {
    const cache = new TTLCache<number>(500);
    const compute = vi.fn().mockResolvedValue(99);

    await cache.getOrSet('key', compute);
    vi.advanceTimersByTime(600);
    await cache.getOrSet('key', compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('supports complex object values', () => {
    const cache = new TTLCache<{ name: string; count: number }>(5000);
    const obj = { name: 'test', count: 7 };
    cache.set('obj', obj);
    expect(cache.get('obj')).toEqual(obj);
  });

  it('overwrites existing entries', () => {
    const cache = new TTLCache<string>(5000);
    cache.set('k', 'first');
    cache.set('k', 'second');
    expect(cache.get('k')).toBe('second');
  });
});
