/** Validate exact journal index and path-safe canonical migration name. */
export function validateMigrationTag(entry, index) {
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index <= 9999 &&
    entry !== null &&
    typeof entry === "object" &&
    entry.idx === index &&
    typeof entry.tag === "string" &&
    /^[0-9]{4}_[a-z0-9_-]+$/.test(entry.tag) &&
    entry.tag.slice(0, 4) === String(index).padStart(4, "0") &&
    Number.isSafeInteger(entry.when)
  );
}
