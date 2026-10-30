import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createGatewayWorkerBootstrap,
  loadGatewayWorkerDescriptor,
} from "./gateway-worker-bootstrap.js";
import type { RuntimeConfig } from "@ii-tonya/config";
import { createSeparatedSalesRunner } from "./expert-separated-sales-composition.js";

it("uses the strict public held runner for bounded capture/cancel recovery", async () => {
  let reconciled = 0;
  const db = {
    execute: async () => ({ rows: [] }),
    transaction: async () => {
      throw Error("unexpected_transaction");
    },
  };
  const held = {
    strictFirstSendCancellation: true as const,
    recoverCheckout: async () => ({ kind: "pending" as const }),
    reconcileKnown: async () => {
      reconciled++;
      return { examined: 0 };
    },
  };
  const runner = createSeparatedSalesRunner(
    db as never,
    {
      features: { expertSeparatedSales: true, expertHeldOnboarding: true },
      expertApplicant: { botId: "1", botKey: "test" },
      expertVerification: {
        paymentMode: "test",
        messagingConsentPolicyVersion: "p",
      },
    } as RuntimeConfig,
    undefined,
    undefined,
    held,
  );
  await runner!.runOnce();
  expect(reconciled).toBe(1);
  runner!.stopAccepting();
  expect(await runner!.runOnce()).toEqual({ stopped: true });
});
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const root = join(process.cwd(), ".getzilla/runtime/scratch");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(root, "public-worker-"));
  dirs.push(dir);
  const write = (name: string, value: string) => {
    const file = join(dir, name);
    writeFileSync(file, value, { mode: 0o600 });
    return file;
  };
  const section = (prefix: string, names: string[]) =>
    Object.fromEntries(
      names.map((name) => [
        name,
        {
          login: prefix + name.toLowerCase(),
          urlFile: write(
            prefix + name,
            `postgresql://${prefix + name.toLowerCase()}:synthetic-only@localhost:1/fixture`,
          ),
        },
      ]),
    );
  const descriptor = {
    version: 1,
    ipc: {
      address: "@unused",
      subjectKeyFile: write(
        "subject",
        Buffer.alloc(32, 1).toString("base64url"),
      ),
      authKeyFile: write("auth", Buffer.alloc(32, 2).toString("base64url")),
      subjectKeyVersion: "v1",
    },
    identityKeyFile: write(
      "identity",
      Buffer.alloc(32, 3).toString("base64url"),
    ),
    tokenFile: write("token", "123:abcdefghijklmnopqrstuvwxyz"),
    botKey: "expert",
    messagingPolicyVersion: "v1",
    databases: section("worker_", [
      "reviewSource",
      "reviewPrepare",
      "finalCall",
      "waveRetention",
      "deferredRetention",
      "publication",
      "launchKit",
    ]),
    publicDatabases: section("public_", [
      "onboardingSender",
      "mainSender",
      "refundSender",
      "binder",
      "observations",
    ]),
    requestKeys: {
      activeReference: "public:v1",
      files: {
        "public:v1": write(
          "request",
          Buffer.alloc(32, 4).toString("base64url"),
        ),
      },
    },
    receiptKeys: {
      activeKeyId: "v1",
      files: {
        v1: write("receipt", Buffer.alloc(32, 5).toString("base64url")),
      },
    },
  };
  const file = write("descriptor", JSON.stringify(descriptor));
  const config = {
    databaseUrl: "postgresql://primary:synthetic-only@localhost:1/fixture",
    yookassaGateway: {
      publicExpertEnabled: true,
      workerConfigFile: file,
      mode: "live",
      returnUrl: "https://ii-tonya.ru/return",
      receipt: { vatCode: 1 },
    },
    expertVerification: {
      paymentMode: "live",
      messagingConsentPolicyVersion: "v1",
    },
  } as RuntimeConfig;
  return { file, descriptor, config };
}
it("opens five bounded dedicated public pools and closes all worker pools once", async () => {
  const f = fixture();
  let created = 0,
    closed = 0;
  const bootstrap = await createGatewayWorkerBootstrap(f.config, ((
    url: string,
    settings: Record<string, unknown>,
  ) => {
    created++;
    expect(settings.connectionTimeoutMillis).toBe(4000);
    return {
      $client: {
        query: async () => ({
          rows: [{ login: new URL(url).username, unsafe: false }],
        }),
        end: async () => {
          closed++;
        },
      },
    };
  }) as never);
  expect(created).toBe(12);
  expect(bootstrap.createPublicRuntime).toBeTypeOf("function");
  await bootstrap.close();
  await bootstrap.close();
  expect(closed).toBe(12);
});
it("cleans partial public startup and rejects absent or shared capability descriptors", async () => {
  const f = fixture();
  let created = 0,
    closed = 0;
  await expect(
    createGatewayWorkerBootstrap(f.config, ((url: string) => {
      if (created === 9) throw Error("startup_failure");
      created++;
      return {
        $client: {
          query: async () => ({
            rows: [{ login: new URL(url).username, unsafe: false }],
          }),
          end: async () => {
            closed++;
          },
        },
      };
    }) as never),
  ).rejects.toThrow("startup_failure");
  expect(closed).toBe(created);
  f.descriptor.publicDatabases.binder =
    f.descriptor.publicDatabases.mainSender!;
  writeFileSync(f.file, JSON.stringify(f.descriptor));
  expect(() =>
    loadGatewayWorkerDescriptor(f.file, f.config.databaseUrl, true),
  ).toThrow("gateway_worker_configuration_invalid");
});
it("keeps separated sales disabled without touching a public capability", () => {
  expect(
    createSeparatedSalesRunner({} as never, { features: {} } as RuntimeConfig),
  ).toBeUndefined();
});
