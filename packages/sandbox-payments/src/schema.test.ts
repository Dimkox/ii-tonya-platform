import {
  PgDialect,
  getTableConfig,
  type AnyPgTable,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  sandboxExpertResidencyCommands,
  sandboxExpertResidencyEvents,
  sandboxExpertResidencyPayments,
} from "./schema.js";

const dialect = new PgDialect();

const metadata = (table: AnyPgTable) => {
  const config = getTableConfig(table);
  return {
    checks: new Map(
      config.checks.map(({ name, value }) => [
        name,
        dialect.sqlToQuery(value).sql,
      ]),
    ),
    indexes: config.indexes.map(({ config: index }) => ({
      columns: index.columns.map((column) =>
        "name" in column ? column.name : undefined,
      ),
      name: index.name,
      partial: index.where !== undefined,
    })),
  };
};

describe("sandbox Drizzle schema parity", () => {
  it("mirrors identifier and command idempotency constraints", () => {
    const payments = metadata(sandboxExpertResidencyPayments);
    const commands = metadata(sandboxExpertResidencyCommands);

    expect(payments.checks.get("sandbox_payment_id_format")).toContain(
      "{22,128}",
    );
    expect(commands.checks.get("sandbox_command_id_format")).toContain(
      "{22,128}",
    );
    expect(commands.checks.get("sandbox_command_idempotency_key")).toMatch(
      /length\(.+\) between 1 and 200.+\^\[A-Za-z0-9_.:-\]\+\$/u,
    );
    expect(commands.indexes).toContainEqual({
      columns: ["payment_id"],
      name: "sandbox_commands_payment_idx",
      partial: false,
    });
  });

  it("mirrors event identifier, correlation, processing, and pending index constraints", () => {
    const events = metadata(sandboxExpertResidencyEvents);

    expect(events.checks.get("sandbox_event_id_format")).toContain("{22,128}");
    expect(events.checks.get("sandbox_event_correlation_id")).toMatch(
      /length\(.+\) between 1 and 200.+\^\[A-Za-z0-9_.:-\]\+\$/u,
    );
    expect(events.checks.get("sandbox_event_processed_at")).toMatch(
      /processed_at.+is null.+processed_at.+>=.+occurred_at/u,
    );
    expect(events.indexes).toContainEqual({
      columns: ["payment_id", "occurred_at", "event_id"],
      name: "sandbox_events_payment_pending_idx",
      partial: true,
    });
  });
});
