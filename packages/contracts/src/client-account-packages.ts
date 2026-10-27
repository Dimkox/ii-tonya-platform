export interface ClientAccountPackages {
  asOf: string;
  totalRemainingUnits: string;
  hasMore: boolean;
  packages: {
    id: string;
    kind: "paid" | "admin" | "intro";
    grantedUnits: number;
    remainingUnits: string;
    expiresAt: string | null;
    status: "active" | "expired" | "exhausted";
  }[];
}
export interface ClientAccountPackagesRepository {
  read(userId: string): Promise<ClientAccountPackages>;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const decimal = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]{0,29})$/u.test(value);
const instant = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/u.test(value)
  )
    return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === value.replace(/(\.\d{3})\d{3}Z$/u, "$1Z")
  );
};
const preciseInstant = (value: string) =>
  value.replace(/(\.\d{3})Z$/u, "$1000Z");
const invalid = (): never => {
  throw new Error("packages_unavailable");
};
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

/** Dependency-free parser shared by native and browser consumers. */
export function parseClientAccountPackages(
  value: unknown,
): ClientAccountPackages {
  if (
    !record(value) ||
    !exactKeys(value, ["asOf", "totalRemainingUnits", "hasMore", "packages"]) ||
    !instant(value.asOf) ||
    !decimal(value.totalRemainingUnits) ||
    typeof value.hasMore !== "boolean" ||
    !Array.isArray(value.packages) ||
    value.packages.length > 50
  )
    return invalid();
  const ids = new Set<string>();
  let total = 0n;
  let inactive = false;
  for (const item of value.packages) {
    if (
      !record(item) ||
      !exactKeys(item, [
        "id",
        "kind",
        "grantedUnits",
        "remainingUnits",
        "expiresAt",
        "status",
      ]) ||
      typeof item.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        item.id,
      ) ||
      ids.has(item.id.toLowerCase()) ||
      typeof item.kind !== "string" ||
      !["paid", "admin", "intro"].includes(item.kind) ||
      typeof item.grantedUnits !== "number" ||
      !Number.isInteger(item.grantedUnits) ||
      item.grantedUnits <= 0 ||
      item.grantedUnits > 2147483647 ||
      !decimal(item.remainingUnits) ||
      !(item.expiresAt === null || instant(item.expiresAt))
    )
      return invalid();
    ids.add(item.id.toLowerCase());
    const expected =
      item.expiresAt !== null &&
      preciseInstant(item.expiresAt) <= preciseInstant(value.asOf)
        ? "expired"
        : item.remainingUnits === "0"
          ? "exhausted"
          : "active";
    if (item.status !== expected || (inactive && expected === "active"))
      return invalid();
    if (expected === "active") total += BigInt(item.remainingUnits);
    else inactive = true;
  }
  if (
    (value.hasMore && value.packages.length !== 50) ||
    ((!value.hasMore || inactive) &&
      total !== BigInt(value.totalRemainingUnits)) ||
    total > BigInt(value.totalRemainingUnits)
  )
    return invalid();
  return value as unknown as ClientAccountPackages;
}
