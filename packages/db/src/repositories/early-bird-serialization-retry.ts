/** Retry only a complete, database-only transaction. Do not perform provider I/O in it. */
export async function retryEarlyBirdSerialization<T>(
  transaction: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await transaction();
    } catch (error) {
      let current: unknown = error;
      const seen = new Set<object>();
      let serialization = false;
      while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current);
        if ("code" in current && current.code === "40001") {
          serialization = true;
          break;
        }
        current = "cause" in current ? current.cause : undefined;
      }
      if (!serialization || attempt >= 2) throw error;
    }
  }
}
