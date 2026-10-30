import {
  constants,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
  realpathSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  rmSync,
  fsyncSync,
  chmodSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = "/opt/ii-tonya-platform/current",
  CONFIG = "/etc/ii-tonya/early-bird-prepare.json",
  SQL = "/etc/ii-tonya/early-bird-runtime-roles.sql",
  MANIFEST = "/etc/ii-tonya/early-bird-code-manifest.json",
  CODE = "/var/lib/ii-tonya-yookassa-code";
const files = [
  "gateway/launcher.py",
  "gateway/bound_gateway.py",
  "gateway/durable_state.py",
  "gateway/gateway.py",
  "gateway/ipc.py",
  "gateway/nonce_registry.py",
  "gateway/pg_authority.py",
  "gateway/provider_reader.py",
  "gateway/subject_tokens.py",
  "gateway/readiness.sql",
  "gateway-provision/prepare_gateway.py",
];
const fail = () => {
  throw new Error("early_bird_prepare_unavailable");
};
function secureRead(path, uid, limit, mode600) {
  let fd;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.uid !== uid ||
      info.nlink !== 1 ||
      info.size < 1 ||
      info.size > limit ||
      (mode600 ? (info.mode & 0o777) !== 0o600 : (info.mode & 0o022) !== 0)
    )
      return fail();
    return readFileSync(fd);
  } catch {
    return fail();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function safeDir(path, uid) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o022) !== 0)
    return fail();
}
function object(bytes) {
  const data = JSON.parse(bytes.toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) return fail();
  return data;
}
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function getPublisherUid() {
  const passwd = secureRead("/etc/passwd", 0, 1048576, false).toString("utf8");
  const matches = passwd
    .split("\n")
    .filter((line) => line.startsWith("ii_tonya:"));
  if (matches.length !== 1) return fail();
  const parts = matches[0].split(":");
  if (parts.length !== 7 || !/^[1-9][0-9]{0,8}$/u.test(parts[2])) return fail();
  return Number(parts[2]);
}
function syncDirectory(path) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function validateStored(target, ownerUid, source) {
  for (const directory of [
    target,
    join(target, "gateway"),
    join(target, "gateway-provision"),
  ]) {
    safeDir(directory, ownerUid);
    if ((lstatSync(directory).mode & 0o777) !== 0o755) return fail();
  }
  const path = join(target, "manifest.json"),
    bytes = secureRead(path, ownerUid, 8192, false),
    manifest = object(bytes);
  if (
    (lstatSync(path).mode & 0o777) !== 0o644 ||
    bytes.toString("utf8").trim() !== JSON.stringify(manifest) ||
    Object.keys(manifest).sort().join(",") !== "files,source_sha" ||
    manifest.source_sha !== source ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    Array.isArray(manifest.files) ||
    Object.keys(manifest.files).sort().join("\n") !==
      [...files].sort().join("\n")
  )
    return fail();
  for (const name of files) {
    const pathname = join(target, name),
      content = secureRead(pathname, ownerUid, 1048576, false);
    if (
      (lstatSync(pathname).mode & 0o777) !== 0o644 ||
      !/^[a-f0-9]{64}$/u.test(manifest.files[name]) ||
      digest(content) !== manifest.files[name]
    )
      return fail();
  }
}
function selectLink(codeDir, source) {
  const link = join(codeDir, `.current-${randomBytes(16).toString("hex")}`);
  try {
    symlinkSync(source, link);
    renameSync(link, join(codeDir, "current"));
  } finally {
    try {
      unlinkSync(link);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  syncDirectory(codeDir);
}
/** Rollback selector reads only previously verified root-published bytes. */
export function selectCodeOnly({
  root = ROOT,
  codeDir = CODE,
  ownerUid = 0,
  publisherUid,
} = {}) {
  const publisher = publisherUid ?? getPublisherUid();
  if (!Number.isSafeInteger(publisher) || publisher <= 0) return fail();
  const release = realpathSync(root);
  safeDir(release, publisher);
  const source = secureRead(join(release, "SOURCE_SHA"), publisher, 128, false)
    .toString("utf8")
    .trim();
  const provenance = object(
    secureRead(join(release, "provenance.json"), publisher, 4096, false),
  );
  if (
    !/^[a-f0-9]{40}$/u.test(source) ||
    provenance.format !== "ii-tonya-native-v1" ||
    provenance.source_sha !== source ||
    !/^[a-f0-9]{64}$/u.test(provenance.source_archive_sha256) ||
    provenance.profile !== undefined ||
    (root === ROOT && release !== `/opt/ii-tonya-platform/releases/${source}`)
  )
    return fail();
  safeDir(codeDir, ownerUid);
  if ((lstatSync(codeDir).mode & 0o777) !== 0o755) return fail();
  validateStored(join(codeDir, source), ownerUid, source);
  selectLink(codeDir, source);
}
/** Production uses only fixed paths and root-owned operator inputs. */
export function prepareNative({
  root = ROOT,
  configPath = CONFIG,
  sqlPath = SQL,
  manifestPath = MANIFEST,
  codeDir = CODE,
  ownerUid = 0,
  publisherUid,
  run = spawnSync,
} = {}) {
  const publisher = publisherUid ?? getPublisherUid();
  if (!Number.isSafeInteger(publisher) || publisher <= 0 || publisher === 0)
    return fail();
  const release = realpathSync(root);
  safeDir(release, publisher);
  const source = secureRead(join(release, "SOURCE_SHA"), publisher, 128, false)
    .toString("utf8")
    .trim();
  const provenance = object(
    secureRead(join(release, "provenance.json"), publisher, 4096, false),
  );
  if (
    !/^[a-f0-9]{40}$/u.test(source) ||
    provenance.format !== "ii-tonya-native-v1" ||
    provenance.source_sha !== source ||
    !/^[a-f0-9]{64}$/u.test(provenance.source_archive_sha256) ||
    (root === ROOT && release !== `/opt/ii-tonya-platform/releases/${source}`)
  )
    return fail();
  if (provenance.profile === "early-bird-compatibility-bridge-v1") {
    if (!/^[a-f0-9]{40}$/u.test(provenance.runtime_source_sha)) return fail();
    return "skipped";
  }
  if (provenance.profile !== undefined) return fail();
  let configBytes;
  try {
    configBytes = secureRead(configPath, ownerUid, 4096, true);
  } catch {
    try {
      lstatSync(configPath);
    } catch (error) {
      if (error?.code === "ENOENT") return "skipped";
    }
    return fail();
  }
  const text = configBytes.toString("utf8");
  if (
    !/^\s*\{\s*(?:"database"\s*:\s*"[a-z][a-z0-9_]{0,62}"\s*,\s*"sql_sha256"\s*:\s*"[a-f0-9]{64}"|"sql_sha256"\s*:\s*"[a-f0-9]{64}"\s*,\s*"database"\s*:\s*"[a-z][a-z0-9_]{0,62}")\s*\}\s*$/u.test(
      text,
    )
  )
    return fail();
  const config = object(configBytes),
    sql = secureRead(sqlPath, ownerUid, 1048576, true);
  if (digest(sql) !== config.sql_sha256) return fail();
  const manifestBytes = secureRead(manifestPath, ownerUid, 8192, true),
    manifest = object(manifestBytes);
  // Canonical JSON rejects duplicate keys and all hidden/unknown fields.
  if (
    manifestBytes.toString("utf8").trim() !== JSON.stringify(manifest) ||
    Object.keys(manifest).sort().join(",") !== "files,source_sha" ||
    manifest.source_sha !== source ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    Array.isArray(manifest.files) ||
    Object.keys(manifest.files).sort().join("\n") !==
      [...files].sort().join("\n")
  )
    return fail();
  for (const name of ["gateway", "gateway-provision"])
    safeDir(join(release, name), publisher);
  const verified = new Map();
  for (const name of files) {
    const bytes = secureRead(join(release, name), publisher, 1048576, false);
    if (
      !/^[a-f0-9]{64}$/u.test(manifest.files[name]) ||
      digest(bytes) !== manifest.files[name]
    )
      return fail();
    verified.set(name, bytes);
  }
  safeDir(codeDir, ownerUid);
  if ((lstatSync(codeDir).mode & 0o777) !== 0o755) return fail();
  const status = run(
    "/usr/bin/systemctl",
    [
      "show",
      "ii-tonya-yookassa-gateway.service",
      "--property=LoadState",
      "--property=ActiveState",
      "--property=MainPID",
      "--value",
    ],
    {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 4096,
      env: { PATH: "/usr/bin:/bin" },
    },
  );
  if (status.error || status.status !== 0) return fail();
  const lines = status.stdout.trim().split("\n");
  if (
    lines.length !== 3 ||
    !lines.includes("loaded") ||
    !lines.includes("inactive") ||
    !lines.includes("0")
  )
    return fail();
  const target = join(codeDir, source),
    staging = join(codeDir, `.stage-${randomBytes(16).toString("hex")}`);
  try {
    mkdirSync(staging, { mode: 0o755 });
    mkdirSync(join(staging, "gateway"), { mode: 0o755 });
    mkdirSync(join(staging, "gateway-provision"), { mode: 0o755 });
    for (const directory of [
      staging,
      join(staging, "gateway"),
      join(staging, "gateway-provision"),
    ])
      chmodSync(directory, 0o755);
    for (const [name, bytes] of verified) {
      const path = join(staging, name);
      writeFileSync(path, bytes, { mode: 0o644, flag: "wx" });
      chmodSync(path, 0o644);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    const publishedManifest = join(staging, "manifest.json");
    writeFileSync(publishedManifest, manifestBytes, {
      mode: 0o644,
      flag: "wx",
    });
    chmodSync(publishedManifest, 0o644);
    const manifestFd = openSync(
      publishedManifest,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      fsyncSync(manifestFd);
    } finally {
      closeSync(manifestFd);
    }
    syncDirectory(join(staging, "gateway"));
    syncDirectory(join(staging, "gateway-provision"));
    syncDirectory(staging);
    try {
      renameSync(staging, target);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") throw error;
      safeDir(target, ownerUid);
      safeDir(join(target, "gateway"), ownerUid);
      safeDir(join(target, "gateway-provision"), ownerUid);
      validateStored(target, ownerUid, source);
      for (const directory of [
        target,
        join(target, "gateway"),
        join(target, "gateway-provision"),
      ])
        if ((lstatSync(directory).mode & 0o777) !== 0o755) return fail();
      for (const name of files) {
        const bytes = secureRead(join(target, name), ownerUid, 1048576, false);
        if (
          digest(bytes) !== manifest.files[name] ||
          (lstatSync(join(target, name)).mode & 0o777) !== 0o644
        )
          return fail();
      }
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  const pg = run(
    "/usr/bin/timeout",
    [
      "--kill-after=2s",
      "38s",
      "/usr/sbin/runuser",
      "-u",
      "postgres",
      "--",
      "/usr/bin/psql",
      "-X",
      "--set",
      "ON_ERROR_STOP=1",
      "--quiet",
      "--host=/var/run/postgresql",
      "--username=postgres",
      `--dbname=${config.database}`,
      "--file=-",
    ],
    {
      input: sql,
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 42000,
      maxBuffer: 1024,
      env: {
        PATH: "/usr/bin:/bin",
        PGCONNECT_TIMEOUT: "5",
        PGOPTIONS: "-c statement_timeout=33000 -c lock_timeout=5000",
      },
    },
  );
  if (pg.error || pg.status !== 0) return fail();
  const gateway = run(
    "/usr/bin/timeout",
    [
      "--kill-after=2s",
      "38s",
      "/usr/sbin/runuser",
      "-u",
      "ii_tonya_gateway",
      "--",
      "/usr/bin/python3",
      "-B",
      join(target, "gateway-provision/prepare_gateway.py"),
    ],
    {
      stdio: "ignore",
      timeout: 42000,
      env: { PATH: "/usr/bin:/bin", PYTHONNOUSERSITE: "1" },
    },
  );
  if (gateway.error || gateway.status !== 0) return fail();
  selectLink(codeDir, source);
  return "prepared";
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--select-code-only")
      selectCodeOnly();
    else if (process.argv.length === 2) prepareNative();
    else fail();
  } catch {
    process.stderr.write("early bird preparation unavailable\n");
    process.exitCode = 1;
  }
}
