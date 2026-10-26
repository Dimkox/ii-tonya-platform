/** Supported providers define case-insensitive identities; unsupported URL paths remain untouched. */
export function canonicalPrivateProfile(profile: string): string {
  try {
    const u = new URL(profile);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash
    )
      return profile;
    const path = u.pathname.replace(/\/$/u, "");
    if (
      ["vk.com", "www.vk.com"].includes(u.hostname) &&
      /^\/(id|club|public)[1-9]\d{0,18}$/iu.test(path)
    )
      return "https://vk.com" + path.toLowerCase();
    if (u.hostname === "t.me" && /^\/[a-z][a-z0-9_]{4,31}$/iu.test(path))
      return "https://t.me" + path.toLowerCase();
    return profile;
  } catch {
    return profile;
  }
}
