import { describe, expect, it } from "vitest";
import { expectPostgresErrorCause } from "./postgres-error.js";

describe("PostgreSQL error cause assertion", () => {
  it("finds a PostgreSQL exception through a bounded cycle-safe cause chain", () => {
    const postgres = Object.assign(new Error("forced outbox failure"), { code: "P0001" });
    const drizzle = Object.assign(new Error("Failed query"), { cause: postgres });
    Object.assign(postgres, { cause: drizzle });
    expect(() => expectPostgresErrorCause(drizzle, "P0001", "forced outbox failure")).not.toThrow();
  });

  it("rejects a non-matching PostgreSQL cause without echoing error details", () => {
    const postgres = Object.assign(new Error("different message"), { code: "P0001" });
    expect(() => expectPostgresErrorCause(postgres, "P0001", "forced audit failure")).toThrow("Expected PostgreSQL error cause did not match");
  });
});
