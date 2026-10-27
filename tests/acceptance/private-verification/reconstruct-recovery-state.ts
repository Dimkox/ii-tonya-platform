import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  constraintStateSql,
  indexStateSql,
  normalizeMigrationSnapshot,
} from "../../../packages/db/src/testkit/migration-state.js";
const req = createRequire(
  new URL("../../../packages/db/package.json", import.meta.url),
);
const { Pool } = req("pg");
const protectedConfig = JSON.parse(
  readFileSync(
    process.env.PRIVATE_EVIDENCE_COMPOSE_CONFIG ??
      "/tmp/verification-form-20261026.compose.json",
    "utf8",
  ),
);
const env = protectedConfig.services.postgres.environment;
const stateDb = "resident_private_jobs_state_0065";
const makeConnection = (db: string) =>
  `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:55483/${db}`;
const adminPool = new Pool({
  connectionString: makeConnection(env.POSTGRES_DB),
});
await adminPool.query(`CREATE DATABASE ${stateDb}`);
const connection = makeConnection(stateDb);
const pool = new Pool({ connectionString: connection });
let output: string | undefined;
try {
  const version = (
    await pool.query("select current_setting('server_version_num') version")
  ).rows[0].version;
  if (version !== "170005") throw Error("wrong_postgres_version");
  const base = "packages/db/migrations";
  const journal = JSON.parse(
    readFileSync(`${base}/meta/_journal.json`, "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const entries = journal.entries.filter((e) => e.idx <= 65);
  if (entries.at(-1)?.idx !== 65) throw Error("journal_65_missing");
  const historic = [];
  for (const e of entries) {
    if (e.idx === 65) {
      for (const submitted of [false, true]) {
        const uid = randomUUID(),
          cid = randomUUID(),
          fid = randomUUID(),
          chat = String(submitted ? 710002 : 710001);
        await pool.query("insert into users(id) values($1)", [uid]);
        await pool.query(
          "insert into channel_identities(id,user_id,provider,bot_key,external_id,external_chat_id,status) values($1,$2,'telegram','upgrade-fixture',$3,$3,'active')",
          [cid, uid, chat],
        );
        await pool.query(
          "insert into residents_applications(id,user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,form_version) values($1,$2,'717171','upgrade-fixture',$3,$4,$4,1)",
          [fid, uid, cid, chat],
        );
        if (submitted) {
          const draft = {
            roles: ["OTHER"],
            primaryRole: "OTHER",
            category: "BASIC",
            tax: "INDIVIDUAL",
            city: "Онлайн",
            socialLinks: ["https://example.com/"],
            motivation: "Практика",
            path: "Путь",
            cases: "Опыт",
          };
          await pool.query(
            "update residents_applications set draft=$2::jsonb,submitted_draft=$2::jsonb,submitted_at=clock_timestamp(),revision=revision+1,status='UNDER_REVIEW',progress='AUTO_CHECK' where id=$1",
            [fid, JSON.stringify(draft)],
          );
        }
        historic.push(
          (
            await pool.query(
              "select id,form_version,draft,submitted_draft,submitted_at,policy_version,education_requirement from residents_applications where id=$1",
              [fid],
            )
          ).rows[0],
        );
      }
    }
    await pool.query(readFileSync(`${base}/${e.tag}.sql`, "utf8"));
  }
  for (const row of historic) {
    const actual = (
      await pool.query(
        "select id,form_version,draft,submitted_draft,submitted_at,policy_version,education_requirement from residents_applications where id=$1",
        [row.id],
      )
    ).rows[0];
    if (JSON.stringify(row) !== JSON.stringify(actual))
      throw Error("historic_form_rewritten");
  }
  console.log(
    JSON.stringify({
      upgradePendingSubmitted: historic.length,
      preserved: true,
    }),
  );
  output = mkdtempSync(join(tmpdir(), "ii-tonya-phase1-0065-"));
  const intro = spawnSync(
    process.execPath,
    [
      "node_modules/drizzle-kit/bin.cjs",
      "introspect",
      "--dialect=postgresql",
      `--url=${connection}`,
      `--out=${output}`,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  writeFileSync(
    ".superpowers/sdd/verification-private-jobs-remediation-20261026/introspection.log",
    `${intro.stdout}\n${intro.stderr}`
      .split(connection)
      .join("[redacted]")
      .split(env.POSTGRES_PASSWORD)
      .join("[redacted]"),
  );
  if (intro.status !== 0) throw Error("introspection_failed");
  writeFileSync(
    ".superpowers/sdd/verification-private-jobs-remediation-20261026/introspected-schema.ts",
    readFileSync(join(output, "schema.ts")),
  );
  const constraints = (await pool.query(constraintStateSql)).rows;
  const indexes = (await pool.query(indexStateSql)).rows;
  const snapshot = normalizeMigrationSnapshot(
    JSON.parse(readFileSync(join(output, "meta/0000_snapshot.json"), "utf8")),
    { constraints, indexes },
  );
  snapshot.prevId = JSON.parse(
    readFileSync(`${base}/meta/0064_snapshot.json`, "utf8"),
  ).id;
  snapshot.id = randomUUID();
  const functions = (
    await pool.query(
      `select p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by name,arguments`,
    )
  ).rows;
  const triggers = (
    await pool.query(
      `select c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition,t.tgenabled enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by table_name,name`,
    )
  ).rows;
  const exclusionConstraints = (
    await pool.query(
      `select r.relname table_name,c.conname name,pg_get_constraintdef(c.oid,true) definition from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='x' order by table_name,name`,
    )
  ).rows;
  const extensions = (
    await pool.query(
      `select extname name,extversion version from pg_extension where extname<>'plpgsql' order by name`,
    )
  ).rows;
  const catalogue = {
    functions,
    triggers,
    exclusionConstraints,
    extensions,
    constraints,
    indexes,
  };
  const snapshotPath = `${base}/meta/0065_snapshot.json`,
    objectsPath = `${base}/state/0065_sql_objects.json`;
  const save = (p: string, v: unknown) =>
    writeFileSync(
      p,
      JSON.stringify(v, null, p.endsWith("_sql_objects.json") ? undefined : 2) +
        "\n",
    );
  save(snapshotPath, snapshot);
  save(objectsPath, catalogue);
  const sha = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
  save(`${base}/state/0065_manifest.json`, {
    databaseVersion: version,
    drizzleKitVersion: "0.31.10",
    method:
      "Full-chain hand-authored SQL replay on isolated PostgreSQL17.5; fresh empty-directory introspection normalized against exact positional constraint/index catalogue. SQL-only functions/triggers retained separately.",
    generatePermitted: false,
    migrations: entries.map((e) => ({
      idx: e.idx,
      tag: e.tag,
      sha256: sha(`${base}/${e.tag}.sql`),
    })),
    snapshotSha256: sha(snapshotPath),
    sqlObjectsSha256: sha(objectsPath),
  });
  console.log(
    JSON.stringify({
      tables: Object.keys(snapshot.tables).length,
      functions: functions.length,
      triggers: triggers.length,
      constraints: constraints.length,
      indexes: indexes.length,
      extensions: extensions.length,
      snapshotPath,
      objectsPath,
    }),
  );
} finally {
  await pool.end();
  if (output) rmSync(output, { recursive: true, force: true });
  await adminPool.query(`DROP DATABASE ${stateDb}`);
  await adminPool.end();
}
