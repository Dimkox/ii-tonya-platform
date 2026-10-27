import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDb, type DrizzleDb } from "./client.js";

const { migrate, readMigrationFiles } = vi.hoisted(() => ({
  migrate: vi.fn(),
  readMigrationFiles: vi.fn(),
}));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
vi.mock("drizzle-orm/migrator", () => ({ readMigrationFiles }));
const rows = [
  { hash: "shared", created_at: "100" },
  { hash: "tip", created_at: "200" },
];
const database = (journal: boolean, existing: boolean, applied = rows) => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ journal, existing }] });
  if (journal) execute.mockResolvedValueOnce({ rows: applied });
  return { db: { execute } as unknown as DrizzleDb, execute };
};

beforeEach(() => {
  vi.clearAllMocks();
  readMigrationFiles.mockReturnValue([
    { hash: "shared", folderMillis: 100 },
    { hash: "tip", folderMillis: 200 },
    { hash: "union", folderMillis: 300 },
  ]);
});

describe("migration history reconciliation fence", () => {
  it("allows a fresh database and a compatible tip prefix", async () => {
    await migrateDb(database(false, false).db, "migrations");
    await migrateDb(database(true, true).db, "migrations");
    expect(migrate).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      { hash: "shared", created_at: "100" },
      { hash: "old-main", created_at: "200" },
    ],
    [
      { hash: "shared", created_at: "100" },
      { hash: "rc-availability", created_at: "200" },
    ],
    [{ hash: "shared", created_at: "101" }],
    [{ hash: "tip", created_at: "200" }],
    [
      ...rows,
      { hash: "union", created_at: "300" },
      { hash: "unknown", created_at: "400" },
    ],
  ])(
    "rejects a divergent, reordered, retimestamped or unknown history before migration: %j",
    async (...applied) => {
      await expect(
        migrateDb(database(true, true, applied).db, "migrations"),
      ).rejects.toThrow("migration_history_reconciliation_required");
      expect(migrate).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "rejects an existing schema without recorded migrations (journal=%s)",
    async (journal) => {
      await expect(
        migrateDb(database(journal, true, []).db, "migrations"),
      ).rejects.toThrow("migration_history_reconciliation_required");
      expect(migrate).not.toHaveBeenCalled();
    },
  );
});
