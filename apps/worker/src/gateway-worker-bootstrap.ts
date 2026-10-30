import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isAbsolute } from "node:path";
import {
  closeDb,
  createDb,
  PostgresEarlyBirdPublicationWorker,
  type DrizzleDb,
} from "@ii-tonya/db";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import type { RuntimeConfig } from "@ii-tonya/config";
import { createDeferredReviewWorker } from "./deferred-review-composition.js";
import { createDeferredFinalCallRuntime } from "./early-bird-deferred-final-call-composition.js";
import { createEarlyBirdPublicationJob } from "./early-bird-publication-job.js";
import { createEarlyBirdLaunchKitRuntime } from "./early-bird-launch-kit-composition.js";

const invalid = (): never => {
  throw new Error("gateway_worker_configuration_invalid");
};
type RecordValue = Record<string, unknown>;
function object(value: unknown, keys: readonly string[]): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const result = value as RecordValue;
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !(key in result))
  )
    return invalid();
  return result;
}
function text(value: unknown, regex: RegExp): string {
  return typeof value === "string" && regex.test(value) ? value : invalid();
}
function path(value: unknown): string {
  const result = text(value, /^\/[A-Za-z0-9_./-]{1,2047}$/u);
  if (
    !isAbsolute(result) ||
    result.split("/").some((part) => part === "." || part === "..")
  )
    return invalid();
  return result;
}
function protectedText(filename: unknown, limit = 65536): string {
  let fd: number | undefined;
  try {
    fd = openSync(path(filename), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size < 1 ||
      stat.size > limit ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      return invalid();
    return readFileSync(fd, "utf8").trim();
  } catch {
    return invalid();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function key(filename: unknown): Buffer {
  const raw = protectedText(filename, 128);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(raw)) return invalid();
  const result = Buffer.from(raw, "base64url");
  if (result.length !== 32 || result.toString("base64url") !== raw)
    return invalid();
  return result;
}
type Credential = { url: string; login: string };
function database(value: unknown, primaryUrl: string): Credential {
  const item = object(value, ["login", "urlFile"]);
  const login = text(item.login, /^[a-z][a-z0-9_]{0,62}$/u);
  const raw = protectedText(item.urlFile, 4096);
  try {
    const url = new URL(raw),
      primary = new URL(primaryUrl);
    const local = ["localhost", "127.0.0.1", "[::1]", "postgres"].includes(
      url.hostname.toLowerCase(),
    );
    const ssl = url.searchParams.getAll("sslmode");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      decodeURIComponent(url.username) !== login ||
      !url.password ||
      !url.hostname ||
      url.pathname.length < 2 ||
      url.hash ||
      url.hostname.toLowerCase() !== primary.hostname.toLowerCase() ||
      (url.port || "5432") !== (primary.port || "5432") ||
      url.pathname !== primary.pathname ||
      ssl.length > 1 ||
      (!local &&
        (ssl.length !== 1 ||
          !["require", "verify-ca", "verify-full"].includes(ssl[0] ?? "")))
    )
      return invalid();
    return { url: raw, login };
  } catch {
    return invalid();
  }
}
const names = [
  "reviewSource",
  "reviewPrepare",
  "finalCall",
  "waveRetention",
  "deferredRetention",
  "publication",
  "launchKit",
] as const;
type DbName = (typeof names)[number];
export function loadGatewayWorkerDescriptor(
  filename: string,
  primaryUrl: string,
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(protectedText(filename));
  } catch {
    return invalid();
  }
  const root = object(parsed, [
    "version",
    "ipc",
    "identityKeyFile",
    "tokenFile",
    "botKey",
    "messagingPolicyVersion",
    "databases",
  ]);
  if (root.version !== 1) return invalid();
  const ipc = object(root.ipc, [
    "address",
    "subjectKeyFile",
    "authKeyFile",
    "subjectKeyVersion",
  ]);
  const address = text(ipc.address, /^@[A-Za-z0-9_.-]{1,99}$/u);
  const subjectKeyVersion = text(
    ipc.subjectKeyVersion,
    /^[A-Za-z0-9_-]{1,64}$/u,
  );
  const subjectKey = key(ipc.subjectKeyFile),
    authKey = key(ipc.authKeyFile),
    identityKey = key(root.identityKeyFile);
  if (
    subjectKey.equals(authKey) ||
    subjectKey.equals(identityKey) ||
    authKey.equals(identityKey)
  )
    return invalid();
  const dbs = object(root.databases, names);
  const databases = Object.fromEntries(
    names.map((name) => [name, database(dbs[name], primaryUrl)]),
  ) as Record<DbName, Credential>;
  if (new Set(names.map((name) => databases[name].login)).size !== names.length)
    return invalid();
  if (
    names.some(
      (name) =>
        databases[name].login ===
        decodeURIComponent(new URL(primaryUrl).username),
    )
  )
    return invalid();
  const token = protectedText(root.tokenFile, 512);
  if (!/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(token))
    return invalid();
  return {
    ipc: {
      address: "\0" + address.slice(1),
      subjectKey,
      authKey,
      subjectKeyVersion,
    },
    identityKey,
    token,
    botKey: text(root.botKey, /^[A-Za-z0-9_.-]{1,100}$/u),
    messagingPolicyVersion: text(
      root.messagingPolicyVersion,
      /^[A-Za-z0-9_.-]{1,100}$/u,
    ),
    databases,
  };
}

/** Separate credentials and bounded pools; no merchant credentials enter the worker. */
export async function createGatewayWorkerBootstrap(
  config: RuntimeConfig,
  createDatabase: typeof createDb = createDb,
) {
  const filename = config.yookassaGateway?.workerConfigFile;
  if (!filename) return invalid();
  const settings = loadGatewayWorkerDescriptor(filename, config.databaseUrl);
  const gateway = new ExperimentalGatewayIpc({
    address: settings.ipc.address,
    key: settings.ipc.subjectKey,
    authKey: settings.ipc.authKey,
    timeoutMs: 10_000,
  });
  const pools: DrizzleDb[] = [];
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= Promise.allSettled(pools.map(closeDb)).then((results) => {
      if (results.some((result) => result.status === "rejected"))
        throw new Error("gateway_worker_pool_close_failed");
    }));
  try {
    const db = {} as Record<DbName, DrizzleDb>;
    for (const name of names) {
      const item = settings.databases[name];
      const pool = createDatabase(item.url, {
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 4000,
        options: "-c statement_timeout=4000 -c lock_timeout=2000",
      });
      pools.push(pool);
      const result = await pool.$client.query<{
        login: string;
        unsafe: boolean;
      }>(
        "select session_user as login, (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole) as unsafe from pg_roles where rolname = session_user",
      );
      if (
        result.rows.length !== 1 ||
        result.rows[0]?.login !== item.login ||
        result.rows[0]?.unsafe !== false
      )
        return invalid();
      db[name] = pool;
    }
    const review = createDeferredReviewWorker({
      sourceDb: db.reviewSource,
      sourceLogin: settings.databases.reviewSource.login,
      prepareDb: db.reviewPrepare,
      prepareLogin: settings.databases.reviewPrepare.login,
      identityKey: settings.identityKey,
    });
    const finalCall = createDeferredFinalCallRuntime({
      db: db.finalCall,
      expectedLogin: settings.databases.finalCall.login,
      botKey: settings.botKey,
      messagingPolicyVersion: settings.messagingPolicyVersion,
      token: settings.token,
    });
    const publication = {
      run: createEarlyBirdPublicationJob(
        new PostgresEarlyBirdPublicationWorker(
          db.publication,
          settings.databases.publication.login,
        ),
      ),
    };
    const launchKit = createEarlyBirdLaunchKitRuntime({
      db: db.launchKit,
      expectedLogin: settings.databases.launchKit.login,
      botKey: settings.botKey,
      messagingPolicyVersion: settings.messagingPolicyVersion,
      token: settings.token,
    });
    if (!review || !finalCall || !launchKit) return invalid();
    return {
      gateway,
      keyVersion: settings.ipc.subjectKeyVersion,
      review,
      finalCall,
      publication,
      launchKit,
      waveRetentionDb: db.waveRetention,
      waveRetentionLogin: settings.databases.waveRetention.login,
      deferredRetentionDb: db.deferredRetention,
      deferredRetentionLogin: settings.databases.deferredRetention.login,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
