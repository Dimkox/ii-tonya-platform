import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeDb,
  createDb,
  defaultMigrationsFolder,
  migrateDb,
  PostgresAdminApprovalRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import { createCanonicalExpertResidencyPaymentEventVerifier } from "@ii-tonya/integrations";
import {
  createSandboxEventVerifier,
  migrateSandboxDatabase,
  PostgresSandboxPaymentRepository,
  SandboxExpertResidencyPaymentAdapter,
  SandboxTransitionWorkflow,
} from "@ii-tonya/sandbox-payments";
import type { FastifyInstance } from "fastify";
import { buildSandboxRoutes } from "./routes.js";

type ApprovalPort = Pick<PostgresAdminApprovalRepository, "resolvePrincipal" | "requestApproval" | "approveApproval">;
type SandboxPaymentAdapter = SandboxExpertResidencyPaymentAdapter & { assertSandboxDatabase(): Promise<void> };

export interface SandboxRuntimeDependencies {
  paymentAdapter: SandboxPaymentAdapter;
  transitionWorkflow: SandboxTransitionWorkflow;
  approvals: ApprovalPort;
}

const allowedEnableFlags = new Set([
  "SELARTI_ENABLED", "PLANERKA_ENABLED", "TELEGRAM_ENABLED", "LLM_ENABLED",
  "INTENT_MODEL_ENABLED", "MAKE_PROJECTION_ENABLED", "GOOGLE_SHEETS_PROJECTION_ENABLED",
  "PAYMENTS_ENABLED", "MINOR_ONBOARDING_ENABLED", "EXPERT_REFERRAL_ENABLED",
  "EXPERT_RESIDENCY_BILLING_ENABLED",
]);
const recognizedPaymentCredential = /^PAYMENTS?_(?:API_?KEY|TOKEN|SECRET|WEBHOOK_SECRET|BASE_URL|PROVIDER)$/u;
const unknownPaymentCredential = /^PAYMENTS?_.+(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PROVIDER)$/u;

export function assertSandboxRuntimeEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.II_TONYA_RUNTIME_MODE !== "sandbox") throw new Error("sandbox_runtime_mode_required");
  for (const key of Object.keys(env)) {
    if (key.endsWith("_ENABLED")) {
      if (!allowedEnableFlags.has(key)) throw new Error("sandbox_unsupported_enable_flag");
      if (env[key] === "true") throw new Error("sandbox_live_integration_forbidden");
    }
    if (recognizedPaymentCredential.test(key) && env[key] !== "")
      throw new Error("sandbox_payment_credentials_forbidden");
    if (!recognizedPaymentCredential.test(key) && unknownPaymentCredential.test(key))
      throw new Error("sandbox_payment_credentials_forbidden");
  }
}

export async function buildSandboxServer(deps: SandboxRuntimeDependencies, env: NodeJS.ProcessEnv = process.env): Promise<FastifyInstance> {
  assertSandboxRuntimeEnvironment(env);
  await deps.paymentAdapter.assertSandboxDatabase();
  return buildSandboxRoutes(deps);
}

export interface SandboxRuntime { dependencies: SandboxRuntimeDependencies; close(): Promise<void> }

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") throw new Error(`sandbox_${key.toLowerCase()}_required`);
  return value;
}

export async function createDefaultSandboxRuntime(env: NodeJS.ProcessEnv): Promise<SandboxRuntime> {
  assertSandboxRuntimeEnvironment(env);
  const db: DrizzleDb = createDb(required(env, "SANDBOX_DATABASE_URL"));
  try {
    await migrateDb(db, defaultMigrationsFolder);
    await migrateSandboxDatabase(db);
    const payments = new PostgresSandboxPaymentRepository(db, new URL(required(env, "SANDBOX_CHECKOUT_BASE_URL")));
    const approvals = new PostgresAdminApprovalRepository(db);
    const verifier = createSandboxEventVerifier(createCanonicalExpertResidencyPaymentEventVerifier());
    const paymentAdapter = new SandboxExpertResidencyPaymentAdapter(payments, verifier);
    return {
      dependencies: { paymentAdapter, approvals, transitionWorkflow: new SandboxTransitionWorkflow(db, approvals, payments) },
      close: () => closeDb(db),
    };
  } catch (error) {
    await closeDb(db);
    throw error;
  }
}

export interface SandboxMainOptions {
  env?: NodeJS.ProcessEnv;
  runtimeFactory?: (env: NodeJS.ProcessEnv) => Promise<SandboxRuntime>;
  listen?: (app: FastifyInstance, options: { host: string; port: number }) => Promise<unknown>;
  installSignals?: boolean;
}

function listenOptions(env: NodeJS.ProcessEnv): { host: string; port: number } {
  const raw = env.SANDBOX_PORT ?? "3001";
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("sandbox_port_invalid");
  return { host: env.SANDBOX_HOST ?? "127.0.0.1", port };
}

export async function main(options: SandboxMainOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  assertSandboxRuntimeEnvironment(env);
  const runtime = await (options.runtimeFactory ?? createDefaultSandboxRuntime)(env);
  let app: FastifyInstance | undefined;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (app !== undefined) await app.close();
    await runtime.close();
  };
  try {
    app = await buildSandboxServer(runtime.dependencies, env);
    await (options.listen ?? ((server, address) => server.listen(address)))(app, listenOptions(env));
    if (options.installSignals === false) await close();
    else {
      const stop = (): void => { void close().finally(() => { process.exitCode = 0; }); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    }
  } catch (error) {
    await close();
    throw error;
  }
}

export function isDirectExecution(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  return resolve(fileURLToPath(moduleUrl)) === resolve(argv1);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void main().catch(() => {
    process.stderr.write("sandbox_startup_failed\n");
    process.exitCode = 1;
  });
}
