import { randomBytes, randomUUID } from "node:crypto";
import {
  createPayerReceiptVault,
  ExperimentalGatewayIpc,
} from "@ii-tonya/integrations";
import { startExpertReferralTestDatabase } from "../../packages/db/src/testkit/expert-referral.js";
import { createPublicExpertRuntimePrincipals } from "../../packages/db/src/testkit/public-expert-runtime-principals.js";
import { createPublicExpertPaymentRuntime } from "../../packages/db/src/public-expert-payment-runtime.js";
import { buildEarlyBirdRoleProvisioningSql } from "../../scripts/provision-early-bird-runtime-roles.mjs";
import {
  startPublicExpertFuturePostgres,
  startPublicExpertGatewayProvider,
} from "./public-expert-gateway-provider.mjs";

type ProviderStats = {
  posts: {
    path: string;
    key: string;
    metadata: Record<string, string> | null;
  }[];
  reads: string[];
};

/** One per file: actual full-schema PG clock, exact capability LOGINs and child
 * gateway. Only the existing provider fixture's destination is local TLS. No
 * source, approval, payment or receipt facts are fabricated by startup. */
export async function startPublicHeldOnboardingFixture() {
  const NativeDate = Date;
  const clock = await startPublicExpertFuturePostgres();
  globalThis.Date = new Proxy(NativeDate, {
    construct(target, args) {
      return Reflect.construct(
        target,
        args.length ? args : [NativeDate.now() + clock.offsetSeconds * 1000],
      );
    },
    get(target, property) {
      return property === "now"
        ? () => NativeDate.now() + clock.offsetSeconds * 1000
        : Reflect.get(target, property);
    },
  });
  let database:
    Awaited<ReturnType<typeof startExpertReferralTestDatabase>> | undefined;
  let principals:
    Awaited<ReturnType<typeof createPublicExpertRuntimePrincipals>> | undefined;
  let provider:
    Awaited<ReturnType<typeof startPublicExpertGatewayProvider>> | undefined;
  let runtime: ReturnType<typeof createPublicExpertPaymentRuntime> | undefined;
  let gatewayLogin: string | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      const failures: unknown[] = [];
      for (const cleanup of [
        () => runtime?.stop(),
        () => provider?.close(),
        () => principals?.close(),
        async () => {
          if (!gatewayLogin || !database) return;
          await database.db.$client.query(`drop owned by ${gatewayLogin}`);
          await database.db.$client.query(`drop role ${gatewayLogin}`);
        },
        () => database?.stop(),
        () => clock.stop(),
      ]) {
        try {
          await cleanup();
        } catch (error) {
          failures.push(error);
        }
      }
      globalThis.Date = NativeDate;
      if (failures.length)
        throw new AggregateError(
          failures,
          "public_held_fixture_cleanup_failed",
        );
    })());
  try {
    const previous = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = clock.connectionString;
    try {
      database = await startExpertReferralTestDatabase();
    } finally {
      if (previous === undefined)
        delete process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
      else process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL = previous;
    }
    principals = await createPublicExpertRuntimePrincipals(database.db);
    const login = "lifecycle_gateway_" + randomUUID().replaceAll("-", "");
    const password = randomBytes(24).toString("hex");
    const provision = await buildEarlyBirdRoleProvisioningSql({
      ii_tonya_wave_gateway: login,
    });
    const admin = await database.db.$client.connect();
    try {
      await admin.query(
        `create role ${login} login inherit password '${password}'`,
      );
      gatewayLogin = login;
      await admin.query(provision);
    } catch (error) {
      await admin.query("rollback");
      throw error;
    } finally {
      admin.release();
    }
    provider = await startPublicExpertGatewayProvider(
      database.db.$client.options.connectionString!,
      login,
      password,
      clock.offsetSeconds,
    );
    const gateway = new ExperimentalGatewayIpc({
      address: provider.address,
      key: Buffer.alloc(32, "k"),
      authKey: Buffer.alloc(32, "a"),
      timeoutMs: 10000,
    });
    const requestKey = randomBytes(32);
    const vault = createPayerReceiptVault({
      activeKeyId: "lifecycle",
      keys: new Map([["lifecycle", randomBytes(32)]]),
    });
    runtime = createPublicExpertPaymentRuntime(database.db, {
      connections: principals.connections,
      gateway,
      mode: "test",
      messagingConsentPolicyVersion: "client-messaging-v1",
      vault,
      requestKey,
      requestKeyReference: "lifecycle:v1",
      retainedRequestKeys: new Map([["lifecycle:v1", requestKey]]),
      returnUrl: "https://example.com/return",
      vatCode: 1,
    });
    await runtime.assertReady();
    const activeProvider = provider;
    return {
      database,
      vault,
      runtime,
      gateway,
      connections: principals.connections,
      stats: () =>
        activeProvider.command({ op: "stats" }) as Promise<ProviderStats>,
      async waiting(paymentId: string) {
        await activeProvider.command({
          op: "payment",
          id: paymentId,
          status: "waiting_for_capture",
        });
      },
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "public_held_fixture_setup_failed",
      );
    }
    throw error;
  }
}
