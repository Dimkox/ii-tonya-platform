import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSandboxRuntimeEnvironment,
  buildSandboxServer,
} from "./server.js";

const validEnv = (): NodeJS.ProcessEnv => ({
  II_TONYA_RUNTIME_MODE: "sandbox",
  SELARTI_ENABLED: "false",
  PLANERKA_ENABLED: "false",
  TELEGRAM_ENABLED: "false",
  LLM_ENABLED: "false",
  INTENT_MODEL_ENABLED: "false",
  MAKE_PROJECTION_ENABLED: "false",
  GOOGLE_SHEETS_PROJECTION_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
});

const token = "A".repeat(32);
const principal = {
  id: "00000000-0000-4000-8000-000000000001",
  sessionIdHash: "",
  roles: ["entitlement_admin"] as const,
  mfaVerifiedAt: new Date(),
};

const dependencies = () => ({
  paymentAdapter: {
    assertSandboxDatabase: vi.fn(async () => undefined),
    createCheckout: vi.fn(),
    reconcile: vi.fn(),
  },
  transitionWorkflow: { execute: vi.fn() },
  approvals: {
    resolvePrincipal: vi.fn(async () => principal),
    requestApproval: vi.fn(),
    approveApproval: vi.fn(),
  },
});

describe("sandbox runtime guard", () => {
  it.each([
    [{}, "sandbox_runtime_mode_required"],
    [{ II_TONYA_RUNTIME_MODE: "production" }, "sandbox_runtime_mode_required"],
    [
      { ...validEnv(), TELEGRAM_ENABLED: "true" },
      "sandbox_live_integration_forbidden",
    ],
    [
      { ...validEnv(), PAYMENT_API_KEY: "present" },
      "sandbox_payment_credentials_forbidden",
    ],
    [
      { ...validEnv(), PAYMENTS_PROVIDER: "present" },
      "sandbox_payment_credentials_forbidden",
    ],
  ])("rejects unsafe environment %#", (env, message) => {
    expect(() => assertSandboxRuntimeEnvironment(env)).toThrow(message);
  });

  it("accepts only the explicit sandbox fail-closed environment", () => {
    expect(() => assertSandboxRuntimeEnvironment(validEnv())).not.toThrow();
  });
});

describe("sandbox server composition", () => {
  const original = process.env;
  afterEach(() => {
    process.env = original;
  });

  it("validates the database marker before constructing a server", async () => {
    process.env = { ...original, ...validEnv() };
    const deps = dependencies();
    deps.paymentAdapter.assertSandboxDatabase.mockRejectedValueOnce(
      new Error("sandbox_database_marker_missing"),
    );
    await expect(buildSandboxServer(deps as never)).rejects.toThrow(
      "sandbox_database_marker_missing",
    );
    expect(deps.approvals.resolvePrincipal).not.toHaveBeenCalled();
  });

  it("builds only after the marker succeeds", async () => {
    process.env = { ...original, ...validEnv() };
    const deps = dependencies();
    const app = await buildSandboxServer(deps as never);
    expect(deps.paymentAdapter.assertSandboxDatabase).toHaveBeenCalledOnce();
    const response = await app.inject({
      method: "GET",
      url: "/sandbox/v1/payments/sandbox_payment_abcdefghijklmnopqrstuv",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
