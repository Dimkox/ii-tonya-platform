import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, stat } from "node:fs/promises";
import { expect, it } from "vitest";
import { createIsolatedDocumentParser } from "../../packages/integrations/src/documents/isolated-document-parser.js";
import { startManagedPrivateParserFixture } from "./managed-private-parser.js";

const execute = promisify(execFile);

it("owns a real isolated parser fixture and removes its Docker and filesystem resources", async () => {
  const fixture = await startManagedPrivateParserFixture();
  try {
    const inspection = JSON.parse(
      (await execute("docker", ["inspect", fixture.container])).stdout,
    )[0];
    expect(inspection.HostConfig).toMatchObject({
      NetworkMode: "none",
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      Memory: 384 * 1024 * 1024,
      MemorySwap: 384 * 1024 * 1024,
      PidsLimit: 16,
      NanoCpus: 1_000_000_000,
    });
    expect(inspection.HostConfig.SecurityOpt).toContain("no-new-privileges");
    expect(inspection.Config.User).toBe(
      `${process.getuid!()}:${process.getgid!()}`,
    );
    expect((await stat(fixture.directory)).mode & 0o777).toBe(0o700);
    const socket = await stat(fixture.socketPath);
    expect(socket.isSocket()).toBe(true);
    expect(socket.mode & 0o777).toBe(0o600);
    expect(socket.uid).toBe(process.getuid!());
    const parser = createIsolatedDocumentParser({
      socketPath: fixture.socketPath,
      ocr: false,
    });
    const result = await parser.parse({
      type: "pdf",
      bytes: fixture.mixedPdf,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ source: "pdf", coverage: "partial" });
    expect(result?.content).toContain("Психолог");
  } finally {
    await fixture.stop();
  }
  await expect(access(fixture.directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(
    execute("docker", ["inspect", fixture.container]),
  ).rejects.toMatchObject({ code: 1 });
  await expect(
    execute("docker", ["image", "inspect", fixture.image]),
  ).rejects.toMatchObject({ code: 1 });
  await expect(fixture.stop()).resolves.toBeUndefined();
}, 180_000);
