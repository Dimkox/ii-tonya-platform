/**
 * Operator CLI for planerka_service_mappings and inactive-test purge.
 * The release entry is scripts/planerka-service-mappings.mjs, which imports
 * the built package and does not need tsx.
 */
import { readFileSync } from "node:fs";
import type { ExpertServiceOfferPatch } from "./repositories/expert-service-offer.js";
import { PostgresExpertServiceOfferRepository } from "./repositories/expert-service-offer.js";
import {
  PostgresPlanerkaServiceMappingAdmin,
  parsePlanerkaServiceMappingFile,
} from "./repositories/planerka-service-mapping-admin.js";
import { PostgresPlanerkaTestPurge } from "./repositories/planerka-test-purge.js";
import { closeDb, createDb } from "./client.js";

type MappingAdmin = Pick<
  PostgresPlanerkaServiceMappingAdmin,
  "list" | "listServices" | "plan" | "apply" | "setEnabled" | "remove"
>;
type PurgeAdmin = Pick<PostgresPlanerkaTestPurge, "purgeInactiveTestExpert">;
type OfferAdmin = Pick<PostgresExpertServiceOfferRepository, "updateOffer">;

const offerText = (value: number | string | null): string =>
  value === null || value === "" ? "-" : String(value);

export function parseExpertServiceOfferFlags(
  argv: readonly string[],
): ExpertServiceOfferPatch {
  if (argv.length === 0 || argv.length % 2 !== 0)
    throw new Error("expert_service_offer_invalid:flags");
  let priceMinor: number | null | undefined;
  let format: ExpertServiceOfferPatch["format"];
  let location: string | null | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1]!;
    if (flag === "--price-minor") {
      if (value === "null") priceMinor = null;
      else if (!/^(?:0|[1-9]\d*)$/u.test(value))
        throw new Error("expert_service_offer_invalid:price");
      else priceMinor = Number(value);
    } else if (flag === "--format") {
      if (value === "null") format = null;
      else if (value === "online" || value === "offline" || value === "hybrid")
        format = value;
      else throw new Error("expert_service_offer_invalid:format");
    } else if (flag === "--location") {
      location = value === "null" ? null : value;
    } else throw new Error("expert_service_offer_invalid:flags");
  }
  return {
    ...(priceMinor === undefined ? {} : { priceMinor }),
    ...(format === undefined ? {} : { format }),
    ...(location === undefined ? {} : { location }),
  };
}

export async function runPlanerkaMappingsCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  out: (line: string) => void,
  admin?: MappingAdmin,
  purge?: PurgeAdmin,
  offers?: OfferAdmin,
): Promise<number> {
  const [command, arg, flag] = argv;
  const usage = () => {
    out(
      "usage: list | services | plan <file> | apply <file> --confirm | disable <id> | enable <id> | remove <id> --confirm | purge-test-expert <expertId> --confirm | set-offer <id> [--price-minor <kopecks|null>] [--format <online|offline|hybrid|null>] [--location <text|null>]",
    );
    return 2;
  };
  if (!command) return usage();
  if (
    (command === "remove" || command === "purge-test-expert") &&
    (!arg || flag !== "--confirm")
  ) {
    out(
      command === "remove"
        ? "remove requires <expertServiceId> --confirm"
        : "purge-test-expert requires <expertId> --confirm",
    );
    return 2;
  }
  const accountEnv = env.PLANERKA_ACCOUNT_ID;
  const expectedAccountId =
    accountEnv === undefined || accountEnv === ""
      ? undefined
      : Number(accountEnv);
  let db: ReturnType<typeof createDb> | undefined;
  const repo =
    admin ??
    (() => {
      if (!env.DATABASE_URL) throw new Error("database_url_required");
      db = createDb(env.DATABASE_URL);
      return new PostgresPlanerkaServiceMappingAdmin(db);
    })();
  const purger = purge ?? (db ? new PostgresPlanerkaTestPurge(db) : undefined);
  try {
    switch (command) {
      case "list": {
        for (const row of await repo.list())
          out(
            `${row.expertServiceId} account=${row.accountId} eventType=${row.eventTypeId} duration=${row.durationMinutes} tz=${row.timeZone} enabled=${row.enabled} verifiedAt=${row.verifiedAt}`,
          );
        return 0;
      }
      case "services": {
        for (const row of await repo.listServices())
          out(
            `${row.expertServiceId} expert=${row.expertId} duration=${row.durationMinutes} active=${row.active} priceMinor=${offerText(row.priceMinor)} currency=${row.currency} format=${offerText(row.format)} location=${offerText(row.location)}`,
          );
        return 0;
      }
      case "plan":
      case "apply": {
        if (!arg) return usage();
        const file = parsePlanerkaServiceMappingFile(
          JSON.parse(readFileSync(arg, "utf8")) as unknown,
          expectedAccountId,
        );
        if (command === "apply" && flag !== "--confirm") {
          out("apply requires --confirm (run plan first)");
          return 2;
        }
        const plan =
          command === "plan" ? await repo.plan(file) : await repo.apply(file);
        for (const entry of plan)
          out(
            `${command === "plan" ? "plan" : "applied"} ${entry.action} ${entry.expertServiceId} duration=${entry.durationMinutes}`,
          );
        return 0;
      }
      case "disable":
      case "enable": {
        if (!arg) return usage();
        const changed = await repo.setEnabled(arg, command === "enable");
        out(`${command} ${arg} ${changed ? "changed" : "unchanged"}`);
        return 0;
      }
      case "remove": {
        const removed = await repo.remove(arg!);
        out(`remove ${arg} ${removed ? "removed" : "absent"}`);
        return 0;
      }
      case "set-offer": {
        if (!arg) return usage();
        let patch: ExpertServiceOfferPatch;
        try {
          patch = parseExpertServiceOfferFlags(argv.slice(2));
        } catch (error) {
          out(
            error instanceof Error
              ? error.message
              : "expert_service_offer_invalid:flags",
          );
          return 2;
        }
        const writer =
          offers ??
          new PostgresExpertServiceOfferRepository(
            db ??
              (() => {
                if (!env.DATABASE_URL) throw new Error("database_url_required");
                db = createDb(env.DATABASE_URL);
                return db;
              })(),
          );
        try {
          const result = await writer.updateOffer(arg, patch);
          out(`set-offer ${arg} ${result}`);
          return result === "updated" ? 0 : 1;
        } catch (error) {
          out(
            error instanceof Error
              ? error.message
              : "expert_service_offer_invalid",
          );
          return 2;
        }
      }
      case "purge-test-expert": {
        if (!purger) {
          if (!env.DATABASE_URL) throw new Error("database_url_required");
          db = createDb(env.DATABASE_URL);
        }
        const actor = purger ?? new PostgresPlanerkaTestPurge(db!);
        const result = await actor.purgeInactiveTestExpert(arg!);
        out(
          `purge-test-expert ${arg} operations=${result.operations} reservations=${result.reservations} slots=${result.slots} services=${result.services} expert=${result.expert} user=${result.user}`,
        );
        return 0;
      }
      default:
        return usage();
    }
  } finally {
    if (db) await closeDb(db);
  }
}
