import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  ExpertCodeCrypto,
  createAdminService,
  type BookingService,
  type CatalogService,
  type ConversationService,
  type ExpertCodeSecretResolver,
  type PrivacyService,
} from "@ii-tonya/application";
import { loadEnv } from "@ii-tonya/config";
import {
  checkDbReadiness,
  closeDb,
  createDb,
  defaultMigrationsFolder,
  migrateDb,
  PostgresAdminApprovalRepository,
  PostgresAdminRepository,
  PostgresExpertReferralControlRepository,
  PostgresWebhookInboxRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  DisabledSelartiAdapter,
  EnvironmentExpertCodeSecretResolver,
} from "@ii-tonya/integrations";
import { createLogger, shutdownTelemetry } from "@ii-tonya/observability";
import { buildApp, type AppDependencies } from "./app.js";
import { createWindowedRateLimiter } from "./rate-limit.js";
import type { FastifyInstance } from "fastify";

export interface ServerLifecycle {
  dependencies(
    config: ReturnType<typeof loadEnv>,
    db: DrizzleDb,
  ): Promise<AppDependencies>;
  migrate(db: DrizzleDb): Promise<void>;
  close(db: DrizzleDb): Promise<void>;
}
export interface DefaultLifecycleOptions {
  readonly expertCodeSecretResolver?: ExpertCodeSecretResolver;
  readonly activeIssuedCodeKeyVersions?: (
    db: DrizzleDb,
  ) => Promise<readonly string[]>;
}
const disabledService = <T extends object>(name: string): T =>
  new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error(`${name} is disabled`);
      },
    },
  ) as T;

export const createDefaultLifecycle = (
  options: DefaultLifecycleOptions = {},
): ServerLifecycle => {
  const expertCodeSecretResolver =
    options.expertCodeSecretResolver ??
    new EnvironmentExpertCodeSecretResolver(process.env);
  const activeIssuedCodeKeyVersions =
    options.activeIssuedCodeKeyVersions ??
    ((db: DrizzleDb) =>
      new PostgresExpertReferralControlRepository(
        db,
      ).activeIssuedCodeKeyVersions());
  return {
    async migrate(db) {
      await migrateDb(db, defaultMigrationsFolder);
    },
    async dependencies(config, db) {
      if (config.features.expertReferral) {
        if (config.expertReferralKeys === null) {
          throw new Error("expert_referral_key_config_unavailable");
        }
        const requiredVersions = await activeIssuedCodeKeyVersions(db);
        new ExpertCodeCrypto(
          expertCodeSecretResolver.resolve({
            currentVersion: config.expertReferralKeys.currentVersion,
            reference: config.expertReferralKeys.reference,
            requiredVersions,
          }),
        );
      }
      const adminApprovals = new PostgresAdminApprovalRepository(db);
      return {
        config,
        conversationService: disabledService<ConversationService>(
          "conversation ingress",
        ),
        bookingService: disabledService<BookingService>("booking ingress"),
        catalogService: disabledService<CatalogService>("catalog ingress"),
        privacyService: disabledService<PrivacyService>("privacy ingress"),
        adminService: createAdminService({
          workflows: new PostgresAdminRepository(db),
        }),
        adminApprovals,
        selarti: new DisabledSelartiAdapter(),
        telegramCallbacks: {
          async isAuthorizedIdentity() {
            return false;
          },
          async verifyCallback() {
            return false;
          },
          async process() {
            throw new Error("Telegram integration is disabled");
          },
        },
        readiness: {
          async check() {
            const state = await checkDbReadiness(db);
            return {
              ...state,
              adapters: Object.values(config.integrations).every(
                (value) => value === false,
              ),
            };
          },
        },
        logger: createLogger(),
        inbox: new PostgresWebhookInboxRepository(db),
        rateLimiter: createWindowedRateLimiter(),
        telegramWebhookSecret: randomBytes(32).toString("base64url"),
      };
    },
    async close(db) {
      await shutdownTelemetry();
      await closeDb(db);
    },
  };
};

export async function composeServer(
  lifecycle: ServerLifecycle,
  db: DrizzleDb,
): Promise<FastifyInstance> {
  await lifecycle.migrate(db);
  return buildApp(await lifecycle.dependencies(loadEnv(process.env), db));
}

export async function closeServer(
  app: FastifyInstance,
  lifecycle: ServerLifecycle,
  db: DrizzleDb,
): Promise<void> {
  await app.close();
  await lifecycle.close(db);
}

export async function listenServer(
  app: FastifyInstance,
  lifecycle: ServerLifecycle,
  db: DrizzleDb,
  address: { host: string; port: number },
  listen: () => Promise<unknown> = () => app.listen(address),
): Promise<void> {
  try {
    await listen();
  } catch (error) {
    await closeServer(app, lifecycle, db);
    throw error;
  }
}

export async function main(
  lifecycle: ServerLifecycle = createDefaultLifecycle(),
): Promise<void> {
  const config = loadEnv(process.env);
  const db = createDb(config.databaseUrl);
  let app: FastifyInstance;
  try {
    app = await composeServer(lifecycle, db);
  } catch (error) {
    await lifecycle.close(db);
    throw error;
  }
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "3000");
  await listenServer(app, lifecycle, db, { host, port });
  let closing: Promise<void> | undefined;
  const shutdown = () => (closing ??= closeServer(app, lifecycle, db));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  void main().catch((error: unknown) => {
    createLogger().fatal({ err: error }, "api startup failed");
    process.exitCode = 1;
  });
}
