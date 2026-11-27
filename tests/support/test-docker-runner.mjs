import { execFileSync } from "node:child_process";
import { constants, readlinkSync } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";

function docker(...args) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  }).trim();
}

/** Only the calling Compose runner may lend its loopback to a test database. */
export function getTestDockerRunner() {
  if (process.env.CLAW_GATE_MODE === undefined) return null;
  const name = hostname();
  if (!/^[a-f0-9]{12}$/u.test(name)) throw Error("invalid Claw test hostname");
  const [id, configuredName, running, network, service] = docker(
    "container",
    "inspect",
    "--format",
    '{{.Id}} {{.Config.Hostname}} {{.State.Running}} {{.HostConfig.NetworkMode}} {{index .Config.Labels "com.docker.compose.service"}}',
    name,
  ).split(" ");
  if (
    !/^[a-f0-9]{64}$/u.test(id) ||
    !id.startsWith(name) ||
    configuredName !== name ||
    running !== "true" ||
    !network ||
    network === "host" ||
    network.startsWith("container:") ||
    service !== "ii-tonya-test"
  )
    throw Error("unrecognized Claw test container");
  const namespaces = ["/proc/self/ns/net", "/proc/self/ns/mnt"];
  if (
    docker("exec", id, "readlink", ...namespaces) !==
    namespaces.map((path) => readlinkSync(path)).join("\n")
  )
    throw Error("Claw test container namespace mismatch");
  return id;
}

export async function getTestPostgresPorts() {
  const runner = getTestDockerRunner();
  if (!runner)
    return {
      dockerArgs: ["-p", "127.0.0.1::5432"],
      postgresArgs: [],
      serverPort: 5432,
      clientPort(container) {
        const port = Number(
          docker(
            "container",
            "inspect",
            "--format",
            '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
            container,
          ),
        );
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw Error("invalid published test PostgreSQL port");
        return port;
      },
    };

  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  return {
    dockerArgs: [`--network=container:${runner}`, "-e", `PGPORT=${port}`],
    postgresArgs: ["-p", String(port), "-c", "listen_addresses=127.0.0.1"],
    serverPort: port,
    clientPort: () => port,
  };
}

export async function startTestPsqlClient(directory) {
  if (getTestDockerRunner()) {
    const psqlPath = "/usr/bin/psql";
    await access(psqlPath, constants.X_OK);
    return { psqlPath, stop() {} };
  }
  const container = docker(
    "run",
    "-d",
    "--network=host",
    "--mount",
    `type=bind,src=${directory},dst=${directory},readonly`,
    "postgres:17.5-bookworm",
    "sleep",
    "infinity",
  );
  if (!/^[a-f0-9]{64}$/u.test(container)) throw Error("invalid test container");
  const stop = () => {
    docker("rm", "-f", container);
  };
  try {
    const psqlPath = join(directory, "psql");
    await writeFile(
      psqlPath,
      `#!/bin/sh\nexec /usr/bin/docker exec -i -e PGSERVICE -e PGSERVICEFILE -e PGPASSFILE ${container} /usr/bin/psql "$@"\n`,
      { mode: 0o700 },
    );
    return { psqlPath, stop };
  } catch (error) {
    stop();
    throw error;
  }
}
