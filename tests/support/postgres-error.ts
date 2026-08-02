export const expectPostgresErrorCause = (
  error: unknown,
  expectedCode: string,
  expectedMessage: string,
): void => {
  const seen = new WeakSet<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 12; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    if (seen.has(current)) break;
    seen.add(current);
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === expectedCode && candidate.message === expectedMessage) {
      return;
    }
    current = candidate.cause;
  }
  throw new Error("Expected PostgreSQL error cause did not match");
};
