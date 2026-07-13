type Entry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

/** Small promise-aware TTL/LRU cache that also deduplicates in-flight work. */
export class AsyncTtlLru<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  getOrCreate(key: string, loader: () => Promise<T>): Promise<T> {
    const current = this.entries.get(key);
    const now = this.now();
    if (current && current.expiresAt > now) {
      this.entries.delete(key);
      this.entries.set(key, current);
      return current.promise;
    }
    if (current) this.entries.delete(key);

    let promise!: Promise<T>;
    promise = loader().catch((error) => {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { expiresAt: now + this.ttlMs, promise });
    while (this.entries.size > Math.max(1, this.maxEntries)) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest == null) break;
      this.entries.delete(oldest);
    }
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
