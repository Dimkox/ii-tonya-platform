import type { DrizzleDb } from "../client.js";
import {
  createAdminRepositoryWithClockForTest,
  type PostgresAdminRepository,
} from "../repositories/admin-repository.js";

export const createTestClockAdminRepository = (
  db: DrizzleDb,
  now: Date,
): PostgresAdminRepository => createAdminRepositoryWithClockForTest(db, now);
