import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const execute = promisify(execFile);
const memoryLimit = String(384 * 1024 * 1024);

async function docker(args: string[], phase: string, timeout = 30_000) {
  try {
    return await execute("docker", args, {
      timeout,
      killSignal: "SIGKILL",
      maxBuffer: 256 * 1024,
    });
  } catch {
    throw new Error(`managed_private_parser_${phase}_failed`);
  }
}

/** Linux-only real parser fixture; owns its image, container and socket directory. */
export async function startManagedPrivateParserFixture() {
  if (process.platform !== "linux" || !process.getuid || !process.getgid)
    throw new Error("managed_private_parser_requires_linux_uid");
  const uid = process.getuid();
  const gid = process.getgid();
  const scratch = resolve(".getzilla/runtime/scratch");
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(scratch, "parser-"));
  const context = join(directory, "context");
  const socketDirectory = join(directory, "socket");
  const identity = randomUUID();
  const image = `ii-tonya-private-parser-test:${identity}`;
  const container = `ii-tonya-private-parser-test-${identity}`;
  let imageBuilt = false;
  let containerCreated = false;
  let socketHandle: Awaited<ReturnType<typeof open>> | undefined;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    const failures: unknown[] = [];
    if (containerCreated) {
      try {
        await docker(["rm", "--force", container], "stop");
        containerCreated = false;
      } catch (error) {
        failures.push(error);
      }
    }
    if (socketHandle) {
      try {
        await socketHandle.close();
        socketHandle = undefined;
      } catch (error) {
        failures.push(error);
      }
    }
    if (imageBuilt) {
      try {
        await docker(["image", "rm", image], "remove_image");
        imageBuilt = false;
      } catch (error) {
        failures.push(error);
      }
    }
    if (!containerCreated) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    stopped = failures.length === 0;
    if (failures.length)
      throw new AggregateError(
        failures,
        "managed_private_parser_cleanup_failed",
      );
  };
  try {
    await mkdir(context, { mode: 0o700 });
    await mkdir(socketDirectory, { mode: 0o700 });
    for (const file of ["requirements.txt", "helper.py", "socket_server.py"])
      await copyFile(
        resolve("packages/integrations/parser", file),
        join(context, file),
      );
    await copyFile(
      resolve("tests/acceptance/private-verification/make-parser-fixtures.py"),
      join(context, "make-parser-fixtures.py"),
    );
    await copyFile(
      resolve("tests/support/managed-private-parser.py"),
      join(context, "managed-private-parser.py"),
    );
    await copyFile(
      resolve("tests/support/managed-private-parser.Dockerfile"),
      join(context, "Dockerfile"),
    );
    await docker(["build", "--tag", image, context], "build", 120_000);
    imageBuilt = true;
    await docker(
      [
        "create",
        "--name",
        container,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        memoryLimit,
        "--memory-swap",
        memoryLimit,
        "--pids-limit",
        "16",
        "--cpus",
        "1",
        "--user",
        `${uid}:${gid}`,
        "--mount",
        `type=bind,source=${socketDirectory},target=/run/private-parser`,
        "--tmpfs",
        "/tmp:size=8m,mode=1777,noexec,nosuid",
        image,
        String(uid),
      ],
      "create",
    );
    containerCreated = true;
    await docker(["start", container], "start");
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const socket = await stat(join(socketDirectory, "s"));
        if (socket.isSocket() && (socket.mode & 0o777) === 0o600) break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (Date.now() >= deadline)
        throw new Error("managed_private_parser_startup_timeout");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    socketHandle = await open(socketDirectory, "r");
    // A held directory descriptor avoids Unix socket path-length limits in long checkouts.
    const socketPath = `/proc/self/fd/${socketHandle.fd}/s`;
    const mixedPdf = await readFile(join(socketDirectory, "mixed.pdf"));
    return { socketPath, mixedPdf, directory, image, container, stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "managed_private_parser_setup_failed",
      );
    }
    throw error;
  }
}
