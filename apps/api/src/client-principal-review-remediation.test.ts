import { getEventListeners } from "node:events";
import { PassThrough } from "node:stream";

import { createClientSessionService } from "@ii-tonya/application";
import { createLogger } from "@ii-tonya/observability";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createClientProofVerifierGate } from "./client-proof-verifier-gate.js";
import { clientSessionRoutes } from "./routes/client-sessions.js";
import { composeServer, type ServerLifecycle } from "./server.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("client principal security review remediation", () => {
  it("propagates the caller signal through the application verifier boundary", async () => {
    const controller = new AbortController();
    const verify = vi.fn(async () => null);
    const service = createClientSessionService({
      verifier: { verify },
      sessions: { issue: vi.fn() },
      generateToken: () => `cs1.${"A".repeat(43)}`,
      digestToken: () => `sha256:${"a".repeat(64)}`,
    });
    await service.issue("P".repeat(32), controller.signal);
    expect(verify.mock.calls[0]?.[0]?.signal).toBe(controller.signal);
  });

  it("does not call the repository when cancellation wins at verifier completion", async () => {
    const controller = new AbortController();
    const issue = vi.fn();
    const service = createClientSessionService({
      verifier: {
        async verify() {
          controller.abort();
          return {
            userId: "00000000-0000-4000-8000-000000000101",
            audience: "ii-tonya-client",
            scope: "client_session:create",
            expiresAt: new Date("2026-08-14T13:00:00.000Z"),
            replayDigest: `hmac-sha256:v1:${"a".repeat(64)}`,
          };
        },
      },
      sessions: { issue },
      generateToken: () => `cs1.${"A".repeat(43)}`,
      digestToken: () => `sha256:${"a".repeat(64)}`,
    });
    await expect(
      service.issue("P".repeat(32), controller.signal),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(issue).not.toHaveBeenCalled();
  });

  it("aborts issuance at the route deadline and creates no repository work", async () => {
    const repositoryCall = vi.fn();
    let observedSignal: AbortSignal | undefined;
    const service = createClientSessionService({
      verifier: createClientProofVerifierGate(
        {
          verify: async ({ signal }) => {
            observedSignal = signal;
            return new Promise((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(new Error("review abort")),
                { once: true },
              );
            });
          },
        },
        { timeoutMs: 10_000 },
      ),
      sessions: { issue: repositoryCall },
      generateToken: () => `cs1.${"A".repeat(43)}`,
      digestToken: () => `sha256:${"a".repeat(64)}`,
    });
    const app = Fastify();
    await app.register(clientSessionRoutes, {
      sessions: {
        issue: service.issue,
        revoke: async () => ({ kind: "denied" as const }),
      },
      principals: { resolve: async () => ({ kind: "denied" }) },
    } as never);
    vi.useFakeTimers();
    const response = app.inject({
      method: "POST",
      url: "/v1/client/sessions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ identityProof: "P".repeat(32) }),
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(response).resolves.toMatchObject({ statusCode: 503 });
    expect(observedSignal?.aborted).toBe(true);
    expect(repositoryCall).not.toHaveBeenCalled();
    await app.close();
  });

  it("removes its abort listener after a completed verifier call", async () => {
    const controller = new AbortController();
    const gate = createClientProofVerifierGate({ verify: async () => null });
    const before = getEventListeners(controller.signal, "abort").length;
    await gate.verify({
      identityProof: "P".repeat(32),
      expectedAudience: "ii-tonya-client",
      expectedScope: "client_session:create",
      signal: controller.signal,
    });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(before);
  });

  it("sanitizes direct and mixed string logger arguments", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    const bearer = `Bearer cs1.${"A".repeat(43)}`;
    createLogger(output).info({ correlationId: "safe-correlation" }, bearer);
    await new Promise((resolve) => output.once("data", resolve));
    const line = Buffer.concat(chunks).toString("utf8");
    expect(line).not.toContain(bearer);
    expect(line).toContain("safe-correlation");
  });

  it("cannot bypass client preflight with a lifecycle missing the hook", async () => {
    const previous = {
      database: process.env.DATABASE_URL,
      session: process.env.CLIENT_SESSION_ENABLED,
      catalog: process.env.CLIENT_CATALOG_ENABLED,
    };
    process.env.DATABASE_URL =
      "postgresql://placeholder.invalid/test?sslmode=require";
    process.env.CLIENT_SESSION_ENABLED = "false";
    process.env.CLIENT_CATALOG_ENABLED = "true";
    const migrate = vi.fn(async () => undefined);
    const lifecycle = {
      migrate,
      dependencies: vi.fn(async () => {
        throw new Error("dependencies_must_not_run");
      }),
      close: vi.fn(async () => undefined),
    } as unknown as ServerLifecycle;
    try {
      await expect(composeServer(lifecycle, {} as never)).rejects.toThrow();
      expect(migrate).not.toHaveBeenCalled();
      expect(lifecycle.dependencies).not.toHaveBeenCalled();
    } finally {
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.session === undefined) delete process.env.CLIENT_SESSION_ENABLED;
      else process.env.CLIENT_SESSION_ENABLED = previous.session;
      if (previous.catalog === undefined) delete process.env.CLIENT_CATALOG_ENABLED;
      else process.env.CLIENT_CATALOG_ENABLED = previous.catalog;
    }
  });
});
