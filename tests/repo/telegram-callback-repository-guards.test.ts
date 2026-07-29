import { describe, expect, it, vi } from "vitest";
import {
  PostgresTelegramCallbackRepository,
  type DrizzleDb,
} from "../../packages/db/src/index.js";

describe("PostgresTelegramCallbackRepository infrastructure failures", () => {
  const repositoryThrowing = (failure: unknown) =>
    new PostgresTelegramCallbackRepository({
      $client: {
        query: vi.fn(async () => {
          throw failure;
        }),
      },
    } as unknown as DrizzleDb);

  it("wraps a database outage as a typed retryable infrastructure error", async () => {
    const databaseFailure = Object.assign(
      new Error("database connection refused"),
      { code: "ECONNREFUSED", errno: -4078, syscall: "connect" },
    );
    const db = {
      $client: {
        query: vi.fn(async () => {
          throw databaseFailure;
        }),
      },
    } as unknown as DrizzleDb;
    const repository = new PostgresTelegramCallbackRepository(db);

    const rejection = repository.peek("opaque-token-hash");
    await expect(rejection).rejects.toMatchObject({
      name: "CallbackInfrastructureError",
      code: "callback_store_unavailable",
      retryable: true,
      cause: databaseFailure,
    });
  });

  it.each([
    ["ECONNRESET", "CallbackInfrastructureError", true],
    ["ETIMEDOUT", "CallbackInfrastructureError", true],
    ["ENOTFOUND", "CallbackInfrastructureError", true],
    ["EAI_AGAIN", "CallbackInfrastructureError", true],
    ["EPIPE", "CallbackInfrastructureError", true],
    ["40001", "CallbackInfrastructureError", true],
    ["40P01", "CallbackInfrastructureError", true],
    ["57P03", "CallbackInfrastructureError", true],
    ["53300", "CallbackInfrastructureError", true],
    ["22P02", "CallbackDataIntegrityError", false],
    ["23505", "CallbackConflictError", false],
    ["42P01", "CallbackDataIntegrityError", false],
    ["UNEXPECTED", "CallbackDataIntegrityError", false],
  ] as const)(
    "classifies SQLSTATE %s without retrying deterministic failures forever",
    async (code, name, retryable) => {
      const databaseFailure = Object.assign(new Error(`SQLSTATE ${code}`), {
        code,
      });
      const db = {
        $client: {
          query: vi.fn(async () => {
            throw databaseFailure;
          }),
        },
      } as unknown as DrizzleDb;
      const repository = new PostgresTelegramCallbackRepository(db);

      await expect(repository.peek("opaque-token-hash")).rejects.toMatchObject({
        name,
        retryable,
        cause: databaseFailure,
      });
    },
  );

  it.each([
    [
      "direct cause",
      new Error("wrapper", {
        cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
      }),
    ],
    [
      "nested cause",
      new Error("outer", {
        cause: new Error("middle", {
          cause: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
        }),
      }),
    ],
    [
      "aggregate mixed children",
      new AggregateError(
        [
          Object.assign(new Error("deterministic"), { code: "22P02" }),
          Object.assign(new Error("retryable"), { code: "40001" }),
        ],
        "aggregate",
      ),
    ],
    [
      "errors iterable",
      Object.assign(new Error("iterable wrapper"), {
        errors: new Set([
          Object.assign(new Error("dns retry"), { code: "EAI_AGAIN" }),
        ]),
      }),
    ],
  ])("finds a transient code through %s", async (_label, failure) => {
    await expect(
      repositoryThrowing(failure).peek("opaque-token-hash"),
    ).rejects.toMatchObject({
      name: "CallbackInfrastructureError",
      retryable: true,
      cause: failure,
    });
  });

  it("terminates on a cyclic cause graph without a transient code", async () => {
    const cyclic = Object.assign(new Error("cyclic deterministic"), {
      code: "UNEXPECTED",
    }) as Error & { cause?: unknown };
    cyclic.cause = cyclic;

    await expect(
      repositoryThrowing(cyclic).peek("opaque-token-hash"),
    ).rejects.toMatchObject({
      name: "CallbackDataIntegrityError",
      retryable: false,
      cause: cyclic,
    });
  });

  it("bounds oversized error collections and ignores transient codes beyond the cap", async () => {
    const errors = Array.from({ length: 256 }, (_, index) =>
      Object.assign(new Error(`deterministic-${index}`), {
        code: index === 255 ? "ECONNRESET" : "UNEXPECTED",
      }),
    );
    const oversized = Object.assign(new Error("oversized"), { errors });

    await expect(
      repositoryThrowing(oversized).peek("opaque-token-hash"),
    ).rejects.toMatchObject({
      name: "CallbackDataIntegrityError",
      retryable: false,
      cause: oversized,
    });
  });

  it("reports corrupt stored callback claims as non-retryable data integrity", async () => {
    const db = {
      $client: {
        query: vi.fn(async () => ({
          rows: [{ callback_claims: "{not-json" }],
          rowCount: 1,
        })),
      },
    } as unknown as DrizzleDb;
    const repository = new PostgresTelegramCallbackRepository(db);

    await expect(repository.peek("opaque-token-hash")).rejects.toMatchObject({
      name: "CallbackDataIntegrityError",
      code: "callback_data_integrity",
      retryable: false,
    });
  });

  it("keeps authoritative service ownership and confirm issuance predicates in SQL", async () => {
    const query = vi.fn<
      (
        statement: string,
        values?: unknown[],
      ) => Promise<{ rows: never[]; rowCount: number }>
    >(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresTelegramCallbackRepository({
      $client: { query },
    } as unknown as DrizzleDb);
    await expect(
      repository.put("opaque-token-hash", {
        reservationId: "00000000-0000-0000-0000-000000000001",
        expertId: "00000000-0000-0000-0000-000000000002",
        action: "confirm",
        version: 1,
        expiresAtEpochSeconds: 1,
      }),
    ).rejects.toMatchObject({ name: "CallbackConflictError" });
    await repository.consumeIfValid({
      tokenHash: "opaque-token-hash",
      expertId: "00000000-0000-0000-0000-000000000002",
      action: "confirm",
      version: 1,
      now: new Date(),
    });

    const statements = query.mock.calls.map(([statement]) =>
      String(statement).replace(/\s+/gu, " "),
    );
    for (const statement of statements) {
      expect(statement).toContain(
        "s.expert_service_id = r.expert_service_id",
      );
      expect(statement).toContain("es.expert_id = r.expert_id");
    }
    expect(statements[0]).toContain(
      "floor(extract(epoch from case when $7 = 'confirm' then least(to_timestamp($5), r.reserved_until) else to_timestamp($5) end)) > floor(extract(epoch from clock_timestamp()))",
    );
    expect(statements[0]).toContain("r.reserved_until > now()");
    expect(statements[0]).toContain("s.starts_at > now()");
    expect(statements[0]).toContain(
      "s.observed_at >= now() - interval '15 minutes'",
    );
    expect(statements[0]).toContain("and es.active");
    expect(statements[0]).toContain(
      "or ($7 = 'cancel' and r.status in ('reserved', 'booked'))",
    );
  });
});
