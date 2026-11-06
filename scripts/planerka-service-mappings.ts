/**
 * SCRUM-519 operator CLI for planerka_service_mappings.
 *
 *   tsx scripts/planerka-service-mappings.ts list
 *   tsx scripts/planerka-service-mappings.ts services
 *   tsx scripts/planerka-service-mappings.ts plan    <file.json>
 *   tsx scripts/planerka-service-mappings.ts apply   <file.json> --confirm
 *   tsx scripts/planerka-service-mappings.ts disable <expertServiceId>
 *   tsx scripts/planerka-service-mappings.ts enable  <expertServiceId>
 *
 * DATABASE_URL is read from the environment. If PLANERKA_ACCOUNT_ID is set,
 * the file's accountId must match it. Nothing secret is printed.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  PostgresPlanerkaServiceMappingAdmin,
  closeDb,
  createDb,
  parsePlanerkaServiceMappingFile,
} from "../packages/db/src/index.js";

export async function runPlanerkaMappingsCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  out: (line: string) => void,
  admin?: Pick<
    PostgresPlanerkaServiceMappingAdmin,
    "list" | "listServices" | "plan" | "apply" | "setEnabled"
  >,
): Promise<number> {
  const [command, arg, flag] = argv;
  const usage = () => {
    out(
      "usage: list | services | plan <file> | apply <file> --confirm | disable <id> | enable <id>",
    );
    return 2;
  };
  if (!command) return usage();
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
      default:
        return usage();
    }
  } finally {
    if (db) await closeDb(db);
  }
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  runPlanerkaMappingsCli(process.argv.slice(2), process.env, (line) =>
    console.log(line),
  ).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(
        error instanceof Error ? error.message.split("\n")[0] : "failed",
      );
      process.exitCode = 1;
    },
  );
}
