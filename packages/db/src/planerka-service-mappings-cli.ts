/**
 * Operator CLI for planerka_service_mappings and inactive-test purge.
 * The release entry is scripts/planerka-service-mappings.mjs, which imports
 * the built package and does not need tsx.
 */
import { readFileSync } from "node:fs";
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

export async function runPlanerkaMappingsCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  out: (line: string) => void,
  admin?: MappingAdmin,
  purge?: PurgeAdmin,
): Promise<number> {
  const [command, arg, flag] = argv;
  const usage = () => {
    out(
      "usage: list | services | plan <file> | apply <file> --confirm | disable <id> | enable <id> | remove <id> --confirm | purge-test-expert <expertId> --confirm",
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
            `${row.expertServiceId} expert=${row.expertId} duration=${row.durationMinutes} active=${row.active}`,
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
