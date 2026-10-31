import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { RuntimeConfig } from "@ii-tonya/config";
import { loadEarlyBirdGatewayBootstrap } from "./early-bird-gateway-bootstrap.js";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "gateway-bootstrap-"));
  dirs.push(dir);
  const secret = (name: string) => {
    const path = join(dir, name);
    writeFileSync(path, randomBytes(32).toString("base64url"), { mode: 0o600 });
    return path;
  };
  const descriptor = {
    version: 1,
    ipc: {
      address: "@gateway-fixture",
      subjectKeyFile: secret("subject"),
      authKeyFile: secret("auth"),
      subjectKeyVersion: "fixture-v1",
    },
    identityKeyFile: secret("identity"),
    requestKeys: {
      activeReference: "vault:v1",
      files: { "vault:v1": secret("request") },
    },
    receiptKeys: {
      activeKeyId: "receipt-v1",
      files: { "receipt-v1": secret("receipt") },
    },
    databases: Object.fromEntries(
      ["sender", "candidateReader", "bindingWriter", "knownBindingReader"].map(
        (name, index) => {
          const login = "runtime_" + index,
            path = join(dir, name);
          writeFileSync(
            path,
            `postgresql://${login}:synthetic-only@localhost:1/fixture`,
            { mode: 0o600 },
          );
          return [name, { urlFile: path, login }];
        },
      ),
    ),
  };
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(descriptor), { mode: 0o600 });
  const config = {
    databaseUrl: "postgresql://primary:synthetic-only@localhost:1/fixture",
    yookassaGateway: {
      mode: "live",
      shopId: "123",
      configurationFile: path,
      returnUrl: "https://ii-tonya.ru/return",
      receipt: {
        vatCode: 1,
        paymentSubject: "service",
        paymentMode: "full_prepayment",
      },
    },
    launchPhase: {
      configuredPhase: "WAVE_1_EARLY_BIRD",
      enrollmentStartMs: Date.parse("2026-11-01T00:00:00+03:00"),
      clientStartMs: Date.parse("2027-01-11T00:00:00+03:00"),
      promoDeadlineDays: 10,
      finalCallTriggerMs: Date.parse("2026-12-28T10:00:00+03:00"),
      policyVersion: "wave1-2027-01-11-v1",
    },
    features: { expertApplicant: true, expertSeparatedSales: true },
    expertApplicant: {
      botId: "1",
      botKey: "fixture-bot",
      messagingConsentPolicyVersion: "client-messaging-v1",
    },
  } as RuntimeConfig;
  return { dir, descriptor, path, config };
}
it("keeps absent gateway mode disabled without reading any file", () => {
  expect(loadEarlyBirdGatewayBootstrap({} as RuntimeConfig)).toBeUndefined();
});
it("constructs a credential-free gateway and isolated lazy database connections from protected files", async () => {
  const f = fixture(),
    bootstrap = loadEarlyBirdGatewayBootstrap(f.config)!;
  try {
    expect(bootstrap.runtime.gateway).toBe(bootstrap.gateway);
    expect(bootstrap.runtime.sender.login).toBe("runtime_0");
    expect(bootstrap.runtime.knownBindingReader.login).toBe("runtime_3");
    expect(bootstrap.runtime).not.toHaveProperty("merchant");
    expect(bootstrap.runtime.checkout.requestKey).toHaveLength(32);
  } finally {
    await bootstrap.close();
  }
});
it("rejects symlink or public-readable configuration and key material", () => {
  const f = fixture();
  chmodSync(f.path, 0o644);
  expect(() => loadEarlyBirdGatewayBootstrap(f.config)).toThrow(
    "early_bird_gateway_bootstrap_configuration_invalid",
  );
  chmodSync(f.path, 0o600);
  chmodSync(f.descriptor.ipc.authKeyFile, 0o644);
  expect(() => loadEarlyBirdGatewayBootstrap(f.config)).toThrow(
    "early_bird_gateway_bootstrap_configuration_invalid",
  );
  chmodSync(f.descriptor.ipc.authKeyFile, 0o600);
  const alias = join(f.dir, "alias");
  symlinkSync(f.path, alias);
  f.config.yookassaGateway!.configurationFile = alias;
  expect(() => loadEarlyBirdGatewayBootstrap(f.config)).toThrow(
    "early_bird_gateway_bootstrap_configuration_invalid",
  );
});
it("rejects shared logins, swapped database identity, unknown fields and mixed keys", () => {
  const f = fixture();
  const save = () =>
    writeFileSync(f.path, JSON.stringify(f.descriptor), { mode: 0o600 });
  f.descriptor.databases.sender!.login = "wrong_login";
  save();
  expect(() => loadEarlyBirdGatewayBootstrap(f.config)).toThrow(
    "early_bird_gateway_bootstrap_configuration_invalid",
  );
  f.descriptor.databases.sender!.login = "runtime_0";
  f.descriptor.ipc.authKeyFile = f.descriptor.ipc.subjectKeyFile;
  save();
  expect(() => loadEarlyBirdGatewayBootstrap(f.config)).toThrow(
    "early_bird_gateway_bootstrap_configuration_invalid",
  );
});
it("assembles full server capabilities from explicit owner, standard, deferred and webhook role descriptors", async () => {
  const f = fixture();
  const connection = (name: string) => {
    const urlFile = join(f.dir, name);
    const login = "full_" + name.toLowerCase();
    writeFileSync(
      urlFile,
      `postgresql://${login}:synthetic-only@localhost:1/fixture`,
      { mode: 0o600 },
    );
    return { urlFile, login };
  };
  const webhookNames = [
    "compositePaymentSettlement",
    "compositeRefundReader",
    "compositeRefundBinding",
    "compositeRefundSettlement",
    "deferredPaymentLookup",
    "deferredSnapshotReader",
    "deferredPaymentBinding",
    "deferredPaymentSettlement",
    "deferredRefundReader",
    "deferredRefundBinding",
    "deferredRefundSettlement",
    "deferredRefundCancel",
  ];
  const descriptor = {
    ...f.descriptor,
    databases: {
      ...f.descriptor.databases,
      standardSender: connection("standard_sender"),
    },
    webhookDatabases: Object.fromEntries(
      webhookNames.map((name, index) => [name, connection("webhook_" + index)]),
    ),
    deferredDatabases: Object.fromEntries(
      ["prepare", "invoice", "send", "bound"].map((name) => [
        name,
        connection("deferred_" + name),
      ]),
    ),
  };
  writeFileSync(f.path, JSON.stringify(descriptor), { mode: 0o600 });
  // Factories create real repositories without acquiring a database connection.
  const bootstrap = loadEarlyBirdGatewayBootstrap(f.config)!;
  try {
    const sourceDb = {} as never;
    const options = bootstrap.serverOptions(sourceDb);
    expect(options.earlyBirdRuntime.recovery.db).toBe(sourceDb);
    expect(options.earlyBirdStandardRuntime.recovery.db).toBe(sourceDb);
    expect(options.earlyBirdRuntime.sender.db).not.toBe(sourceDb);
    expect(options.earlyBirdRuntime.bindingWriter.db).not.toBe(sourceDb);
    expect(options.earlyBirdRuntime.gateway).toBe(bootstrap.gateway);
    expect(options.earlyBirdStandardRuntime.gateway).toBe(bootstrap.gateway);
    expect(typeof options.earlyBirdDeferred.prepare).toBe("function");
    expect(typeof options.yookassaWebhook.verify).toBe("function");
    expect(typeof options.earlyBirdWebhookRouting.resolvePurpose).toBe(
      "function",
    );
  } finally {
    await bootstrap.close();
  }
});
it("refuses production assembly from an incomplete descriptor", async () => {
  const f = fixture(),
    bootstrap = loadEarlyBirdGatewayBootstrap(f.config)!;
  try {
    expect(() => bootstrap.serverOptions({} as never)).toThrow(
      "early_bird_gateway_bootstrap_configuration_invalid",
    );
  } finally {
    await bootstrap.close();
  }
});
