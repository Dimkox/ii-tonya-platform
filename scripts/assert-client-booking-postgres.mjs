import pg from "pg";

const connectionString = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
if (typeof connectionString !== "string" || connectionString.length === 0) {
  throw new Error("client_booking_postgres_admin_url_required");
}

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  const result = await pool.query("show server_version_num");
  const version = result.rows[0]?.server_version_num;
  if (version !== "170005") {
    throw new Error("client_booking_postgres_version_mismatch");
  }
  process.stdout.write("client_booking_postgres_version=170005\n");
} finally {
  await pool.end();
}
