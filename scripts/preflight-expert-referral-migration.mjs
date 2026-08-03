import { createRequire } from "node:module";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write(
    "EXPERT-IDENTITY-PREFLIGHT: status=error reason=database_url_required\n",
  );
  process.exitCode = 2;
} else {
  const requireFromDb = createRequire(
    new URL("../packages/db/package.json", import.meta.url),
  );
  const { Pool } = requireFromDb("pg");
  const pool = new Pool({ connectionString });
  try {
    await pool.query("begin transaction read only");
    const result = await pool.query(`
      select count(*)::integer as duplicate_groups
      from (
        select user_id
        from experts
        group by user_id
        having count(*) > 1
      ) duplicate_expert_users
    `);
    await pool.query("commit");
    const duplicateGroups = Number(result.rows[0]?.duplicate_groups ?? 0);
    if (duplicateGroups === 0) {
      process.stdout.write("EXPERT-IDENTITY-PREFLIGHT: duplicate_groups=0\n");
    } else {
      process.stderr.write(
        `EXPERT-IDENTITY-PREFLIGHT: sqlstate=P0001 marker=expert_user_identity_duplicates duplicate_groups=${duplicateGroups}\n`,
      );
      process.exitCode = 1;
    }
  } catch {
    try {
      await pool.query("rollback");
    } catch {
      // Preserve the primary fail-closed result without exposing connection data.
    }
    process.stderr.write(
      "EXPERT-IDENTITY-PREFLIGHT: status=error reason=query_failed\n",
    );
    process.exitCode = 2;
  } finally {
    await pool.end();
  }
}
