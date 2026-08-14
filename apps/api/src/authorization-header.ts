export const readExactAuthorization = (
  rawHeaders: readonly string[],
): string | null => {
  if (rawHeaders.length % 2 !== 0) return null;
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === "authorization") {
      const value = rawHeaders[index + 1];
      if (value === undefined) return null;
      values.push(value);
    }
  }
  if (values.length !== 1 || values[0]!.includes(",")) return null;
  return values[0]!;
};
