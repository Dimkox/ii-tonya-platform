import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresEarlyBirdOnboardingStatus } from "./early-bird-onboarding-status.js";

let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.migrate();
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);

it("reads current PostgreSQL schema and fails closed for unknown users", async () => {
  expect(
    await new PostgresEarlyBirdOnboardingStatus(fixture.db).find(randomUUID()),
  ).toBeNull();
}, 120_000);
