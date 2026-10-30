/** Prevent a database driver's parameter-bearing error from escaping this boundary.
 * This does not configure SQL driver, telemetry, proxy, or PostgreSQL logging. */
export async function executeOpaqueTokenOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error("early_bird_dispatch_unavailable");
  }
}
