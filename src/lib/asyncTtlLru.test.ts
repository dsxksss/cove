import { describe, expect, it } from "vitest";
import { AsyncTtlLru } from "./asyncTtlLru";

describe("AsyncTtlLru", () => {
  it("deduplicates concurrent loads and expires by TTL", async () => {
    let now = 10;
    let calls = 0;
    const cache = new AsyncTtlLru<number>(4, 100, () => now);
    const load = async () => ++calls;
    const [a, b] = await Promise.all([
      cache.getOrCreate("song:quality", load),
      cache.getOrCreate("song:quality", load),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(calls).toBe(1);
    now = 111;
    expect(await cache.getOrCreate("song:quality", load)).toBe(2);
  });

  it("evicts the least recently used key", async () => {
    const cache = new AsyncTtlLru<number>(2, 1000, () => 0);
    await cache.getOrCreate("a", async () => 1);
    await cache.getOrCreate("b", async () => 2);
    await cache.getOrCreate("a", async () => 3);
    await cache.getOrCreate("c", async () => 3);
    expect(cache.size).toBe(2);
    let reloaded = 0;
    await cache.getOrCreate("b", async () => ++reloaded);
    expect(reloaded).toBe(1);
  });

  it("keeps audio qualities isolated by cache key", async () => {
    const cache = new AsyncTtlLru<string>(4, 1000, () => 0);
    let calls = 0;
    const standard = await cache.getOrCreate("netease:1:standard", async () => `url-${++calls}`);
    const lossless = await cache.getOrCreate("netease:1:lossless", async () => `url-${++calls}`);
    expect(standard).toBe("url-1");
    expect(lossless).toBe("url-2");
  });

  it("does not cache a rejected in-flight request", async () => {
    const cache = new AsyncTtlLru<number>(4, 1000, () => 0);
    try {
      await cache.getOrCreate("song", async () => {
        throw new Error("network");
      });
    } catch {
      /* expected */
    }
    expect(await cache.getOrCreate("song", async () => 2)).toBe(2);
  });
});
