import { describe, expect, it, vi } from "vitest";

import { CLIENT_CATALOG_OUTBOX_TOPICS } from "../../../contracts/src/worker-outbox.js";
import type { DrizzleDb } from "../client.js";
import { PostgresOutboxRepository } from "./outbox-repository.js";

describe("PostgreSQL client catalog outbox allowlist", () => {
  it("accepts the exact client catalog composite allowlist", () => {
    expect(
      () =>
        new PostgresOutboxRepository(
          { transaction: vi.fn() } as unknown as DrizzleDb,
          CLIENT_CATALOG_OUTBOX_TOPICS,
        ),
    ).not.toThrow();
  });
});
