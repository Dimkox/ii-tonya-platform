import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { startPublicHeldOnboardingFixture } from "../support/public-held-onboarding-fixture.js";

it("starts actual public capability pools and authenticated gateway together, then drains and restores its isolated clock", async () => {
  const originalDate = Date;
  const originalAdmin = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  const fixture = await startPublicHeldOnboardingFixture();
  try {
    const timing = (
      await fixture.database.db.$client.query(
        "select current_setting('server_version_num') version,extract(epoch from clock_timestamp())*1000 now",
      )
    ).rows[0]!;
    expect(timing.version).toBe("170005");
    expect(Math.abs(Number(timing.now) - Date.now())).toBeLessThan(1500);
    expect(Date.now()).toBeGreaterThanOrEqual(
      Date.parse("2027-01-11T12:00:00Z"),
    );
    expect(process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL).toBe(originalAdmin);
    await fixture.runtime.assertReady();
    await fixture.gateway.barrier();
    expect(Object.keys(fixture.connections)).toHaveLength(5);
    for (const { login, db } of Object.values(fixture.connections)) {
      expect((await db.$client.query("select session_user name")).rows).toEqual(
        [{ name: login }],
      );
      await expect(
        db.$client.query("select * from payer_receipt_contacts"),
      ).rejects.toMatchObject({ code: "42501" });
    }
    // Bootstrapping the composite fixture grants no fee, review or provider fact.
    expect(
      (
        await fixture.database.db.$client.query(
          "select count(*)::int n from expert_onboarding_payment_facts",
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    const contact = randomUUID();
    await fixture.gateway.revokeContact(contact);
    expect(
      (
        await fixture.database.db.$client.query(
          "select revoked_at is not null revoked from early_bird_gateway_contact_state where contact_id=$1",
          [contact],
        )
      ).rows,
    ).toEqual([{ revoked: true }]);
    expect(await fixture.stats()).toMatchObject({ posts: [], reads: [] });
    const closing = fixture.close();
    expect(fixture.close()).toBe(closing);
    await closing;
    for (const { db } of Object.values(fixture.connections))
      await expect(db.$client.query("select 1")).rejects.toThrow();
    await expect(fixture.gateway.barrier()).rejects.toThrow();
    expect(Date).toBe(originalDate);
    expect(process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL).toBe(originalAdmin);
  } finally {
    await fixture.close();
  }
}, 180000);
