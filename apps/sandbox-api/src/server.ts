import type { PostgresAdminApprovalRepository } from "@ii-tonya/db";
import type {
  SandboxExpertResidencyPaymentAdapter,
  SandboxTransitionWorkflow,
} from "@ii-tonya/sandbox-payments";
import type { FastifyInstance } from "fastify";
import { buildSandboxRoutes } from "./routes.js";

type ApprovalPort = Pick<
  PostgresAdminApprovalRepository,
  "resolvePrincipal" | "requestApproval" | "approveApproval"
>;
type SandboxPaymentAdapter = SandboxExpertResidencyPaymentAdapter & {
  assertSandboxDatabase(): Promise<void>;
};

export interface SandboxRuntimeDependencies {
  paymentAdapter: SandboxPaymentAdapter;
  transitionWorkflow: SandboxTransitionWorkflow;
  approvals: ApprovalPort;
}

const liveIntegrationKeys = new Set([
  "SELARTI_ENABLED",
  "PLANERKA_ENABLED",
  "TELEGRAM_ENABLED",
  "LLM_ENABLED",
  "INTENT_MODEL_ENABLED",
  "MAKE_PROJECTION_ENABLED",
  "GOOGLE_SHEETS_PROJECTION_ENABLED",
  "PAYMENTS_ENABLED",
]);
const paymentCredentialKey =
  /^PAYMENTS?_(?:API_?KEY|TOKEN|SECRET|WEBHOOK_SECRET|BASE_URL|PROVIDER)$/u;

export function assertSandboxRuntimeEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.II_TONYA_RUNTIME_MODE !== "sandbox")
    throw new Error("sandbox_runtime_mode_required");
  for (const key of liveIntegrationKeys) {
    if (env[key] === "true")
      throw new Error("sandbox_live_integration_forbidden");
  }
  if (Object.keys(env).some((key) => paymentCredentialKey.test(key)))
    throw new Error("sandbox_payment_credentials_forbidden");
}

export async function buildSandboxServer(
  deps: SandboxRuntimeDependencies,
): Promise<FastifyInstance> {
  assertSandboxRuntimeEnvironment(process.env);
  await deps.paymentAdapter.assertSandboxDatabase();
  return buildSandboxRoutes(deps);
}
