import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

describe("native service outbound HTTP runtime", () => {
  it.each([
    ["api", "api/dist/server.js"],
    ["worker", "worker/dist/main.js"],
  ])(
    "%s reads a real HTTP response using its shipped Node flags",
    async (service, entrypoint) => {
      expect(process.versions.node.split(".")[0]).toBe("24");
      const unit = readFileSync(
        `deploy/systemd/ii-tonya-${service}.service`,
        "utf8",
      );
      const commands = [...unit.matchAll(/^ExecStart=(.+)$/gmu)];
      expect(commands).toHaveLength(1);
      // The shipped units use plain whitespace-separated arguments. Fail closed if
      // quoting, escaping or systemd expansion is introduced instead of guessing.
      const command = commands[0]![1]!;
      expect(command).not.toMatch(/["'\\$%]/u);
      const args = command.trim().split(/\s+/u);
      expect(args.shift()).toBe("/usr/bin/node");
      expect(args.pop()).toBe(entrypoint);

      const body = '{"fixture":"native HTTP — Тоня","ok":true}\n';
      const server = createServer((_request, response) => {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          connection: "close",
        });
        response.end(body);
      });

      const listener = new AbortController();
      const startupTimer = setTimeout(
        () => listener.abort(new Error("Loopback listener startup timed out")),
        2_000,
      );
      try {
        server.listen({ port: 0, host: "127.0.0.1", signal: listener.signal });
        await once(server, "listening", { signal: listener.signal });
        clearTimeout(startupTimer);
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Expected an ephemeral loopback TCP listener");
        }
        const result = await new Promise<{
          error: Error | null;
          stdout: string;
          stderr: string;
        }>((resolve) => {
          execFile(
            process.execPath,
            [
              ...args,
              "--input-type=module",
              "--eval",
              `
              import assert from "node:assert/strict";
              const response = await fetch(process.argv[1], {
                signal: AbortSignal.timeout(2_000),
                redirect: "error",
              });
              assert.equal(response.status, 200);
              process.stdout.write(await response.text());
            `,
              `http://127.0.0.1:${address.port}/fixture`,
            ],
            {
              // Test-only bypass: no inherited NODE_OPTIONS, proxies or secrets.
              env: { NODE_USE_ENV_PROXY: "0", NO_PROXY: "*", no_proxy: "*" },
              encoding: "utf8",
              timeout: 5_000,
              killSignal: "SIGKILL",
              maxBuffer: 16 * 1024,
            },
            (error, stdout, stderr) => resolve({ error, stdout, stderr }),
          );
        });
        expect(result.error, result.stderr).toBeNull();
        expect(result.stdout).toBe(body);
        expect(result.stderr).toBe("");
      } finally {
        clearTimeout(startupTimer);
        listener.abort();
        server.closeAllConnections();
        try {
          await server[Symbol.asyncDispose]();
        } catch (error) {
          // Aborting the listener can finish close before async disposal runs.
          // Only that already-closed result is safe to ignore.
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            error.code !== "ERR_SERVER_NOT_RUNNING"
          ) {
            throw error;
          }
        }
      }
    },
    10_000,
  );
});
