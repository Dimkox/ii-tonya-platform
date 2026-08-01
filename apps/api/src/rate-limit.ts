export interface RateLimitGate {
  consume(key: string, limit: number, windowMs: number): boolean;
}

export function createWindowedRateLimiter(options: { now?: () => number; maxKeys?: number } = {}): RateLimitGate {
  const buckets = new Map<string, { startedAt: number; count: number }>();
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  return {
    consume(key, limit, windowMs) {
      const timestamp = now();
      const current = buckets.get(key);
      if (current === undefined || timestamp - current.startedAt >= windowMs) {
        if (buckets.size >= maxKeys) {
          const oldest = buckets.keys().next().value as string | undefined;
          if (oldest !== undefined) buckets.delete(oldest);
        }
        buckets.set(key, { startedAt: timestamp, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    },
  };
}
