export type EarlyBirdPublicationCandidate = {
  userId: string;
  sourceId: string;
};
export type EarlyBirdPublicationStore = {
  scan(
    limit: number,
    after: EarlyBirdPublicationCandidate | null,
  ): Promise<EarlyBirdPublicationCandidate[]>;
  activate(candidate: EarlyBirdPublicationCandidate): Promise<void>;
};

/** Bounded polling. Each activation must re-check eligibility in its own
 * serializable transaction; stale candidates never prevent later ones. */
export function createEarlyBirdPublicationJob(
  store: EarlyBirdPublicationStore,
) {
  let running = false;
  let after: EarlyBirdPublicationCandidate | null = null;
  return async (
    limit = 20,
    signal: AbortSignal = new AbortController().signal,
  ) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("early_bird_publication_limit_invalid");
    const counts = { attempted: 0, published: 0, failed: 0 };
    if (running || signal.aborted) return counts;
    running = true;
    try {
      const candidates = await store.scan(limit, after);
      if (candidates.length > limit)
        throw new Error("early_bird_publication_scan_invalid");
      for (const candidate of candidates) {
        if (signal.aborted) break;
        after = candidate;
        counts.attempted++;
        try {
          await store.activate(candidate);
          counts.published++;
        } catch {
          counts.failed++;
        }
      }
      if (!signal.aborted && candidates.length < limit) after = null;
      return counts;
    } finally {
      running = false;
    }
  };
}
