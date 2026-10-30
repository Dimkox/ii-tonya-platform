import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadGatewayWorkerDescriptor } from "./gateway-worker-bootstrap.js";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
it("loads only a protected separate worker descriptor and rejects unsafe files", () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-gateway-"));
  dirs.push(dir);
  const file = (name: string, value: string) => {
    const path = join(dir, name);
    writeFileSync(path, value, { mode: 0o600 });
    return path;
  };
  const subjectKeyFile = file(
    "subject",
    Buffer.alloc(32, 1).toString("base64url"),
  );
  const authKeyFile = file("auth", Buffer.alloc(32, 2).toString("base64url"));
  const identityKeyFile = file(
    "identity",
    Buffer.alloc(32, 3).toString("base64url"),
  );
  const tokenFile = file("token", "123:abcdefghijklmnopqrstuvwxyz");
  const names = [
    "reviewSource",
    "reviewPrepare",
    "finalCall",
    "waveRetention",
    "deferredRetention",
    "publication",
    "launchKit",
  ];
  const databases = Object.fromEntries(
    names.map((name, i) => [
      name,
      {
        login: `worker_${i}`,
        urlFile: file(
          name,
          `postgresql://worker_${i}:password@localhost/tonya`,
        ),
      },
    ]),
  );
  const descriptor = file(
    "descriptor",
    JSON.stringify({
      version: 1,
      ipc: {
        address: "@worker",
        subjectKeyFile,
        authKeyFile,
        subjectKeyVersion: "v1",
      },
      identityKeyFile,
      tokenFile,
      botKey: "expert",
      messagingPolicyVersion: "v1",
      databases,
    }),
  );
  const result = loadGatewayWorkerDescriptor(
    descriptor,
    "postgresql://app:password@localhost/tonya",
  );
  expect(result.ipc.subjectKeyVersion).toBe("v1");
  expect(result.databases.reviewPrepare.login).toBe("worker_1");
  chmodSync(authKeyFile, 0o644);
  expect(() =>
    loadGatewayWorkerDescriptor(
      descriptor,
      "postgresql://app:password@localhost/tonya",
    ),
  ).toThrow("gateway_worker_configuration_invalid");
});

it("closes every opened pool when role verification fails", async () => {
  const { createGatewayWorkerBootstrap } =
    await import("./gateway-worker-bootstrap.js");
  const dir = mkdtempSync(join(tmpdir(), "worker-pools-"));
  dirs.push(dir);
  const file = (name: string, value: string) => {
    const p = join(dir, name);
    writeFileSync(p, value, { mode: 0o600 });
    return p;
  };
  const subject = file("subject", Buffer.alloc(32, 1).toString("base64url"));
  const auth = file("auth", Buffer.alloc(32, 2).toString("base64url"));
  const identity = file("identity", Buffer.alloc(32, 3).toString("base64url"));
  const token = file("token", "123:abcdefghijklmnopqrstuvwxyz");
  const names = [
    "reviewSource",
    "reviewPrepare",
    "finalCall",
    "waveRetention",
    "deferredRetention",
    "publication",
    "launchKit",
  ];
  const databases = Object.fromEntries(
    names.map((name, i) => [
      name,
      {
        login: `worker_${i}`,
        urlFile: file(
          name,
          `postgresql://worker_${i}:password@localhost/tonya`,
        ),
      },
    ]),
  );
  const descriptor = file(
    "descriptor",
    JSON.stringify({
      version: 1,
      ipc: {
        address: "@worker",
        subjectKeyFile: subject,
        authKeyFile: auth,
        subjectKeyVersion: "v1",
      },
      identityKeyFile: identity,
      tokenFile: token,
      botKey: "expert",
      messagingPolicyVersion: "v1",
      databases,
    }),
  );
  let created = 0,
    closed = 0;
  const connect = ((url: string) => {
    const index = created++;
    return {
      $client: {
        query: async () => ({
          rows: [{ login: new URL(url).username, unsafe: index === 2 }],
        }),
        end: async () => {
          closed++;
        },
      },
    };
  }) as unknown as typeof import("@ii-tonya/db").createDb;
  const config = {
    databaseUrl: "postgresql://app:password@localhost/tonya",
    yookassaGateway: { workerConfigFile: descriptor },
  } as unknown as import("@ii-tonya/config").RuntimeConfig;
  await expect(createGatewayWorkerBootstrap(config, connect)).rejects.toThrow(
    "gateway_worker_configuration_invalid",
  );
  expect(created).toBe(3);
  expect(closed).toBe(3);
  created = 0;
  closed = 0;
  const validConnect = ((url: string) => {
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
  }) as unknown as typeof import("@ii-tonya/db").createDb;
  const bootstrap = await createGatewayWorkerBootstrap(config, validConnect);
  expect(bootstrap.gateway).toBeDefined();
  expect(bootstrap.review.run).toBeTypeOf("function");
  expect(bootstrap.finalCall.run).toBeTypeOf("function");
  expect(bootstrap.publication.run).toBeTypeOf("function");
  expect(bootstrap.launchKit.run).toBeTypeOf("function");
  await bootstrap.close();
  await bootstrap.close();
  expect(created).toBe(7);
  expect(closed).toBe(7);
});
