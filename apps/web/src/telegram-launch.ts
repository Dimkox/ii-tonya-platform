/** Telegram's signed launch data lives in the fragment, never in browser storage. */
export function readMiniAppLaunchData(hash: string): string {
  if (hash.length > 20000) return "";
  const values = new URLSearchParams(hash.replace(/^#/u, "")).getAll(
    "tgWebAppData",
  );
  const value = values.length === 1 ? values[0]! : "";
  return new TextEncoder().encode(value).length <= 6139 ? value : "";
}
