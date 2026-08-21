import { createRequire } from "node:module";

const requireFromDbPackage = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { Client } = requireFromDbPackage("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write("preflight_failed\n");
  process.exitCode = 2;
} else {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(`
      select count(*)::integer as duplicate_groups
      from (
        select user_id
        from experts
        group by user_id
        having count(*) > 1
      ) duplicates
    `);
    const duplicateGroups = Number(result.rows[0]?.duplicate_groups ?? -1);
    process.stdout.write(`duplicate_groups=${duplicateGroups}\n`);
    if (duplicateGroups !== 0) process.exitCode = 1;
  } catch {
    process.stderr.write("preflight_failed\n");
    process.exitCode = 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}
