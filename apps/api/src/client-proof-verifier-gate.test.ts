import { describe, expect, it, vi } from "vitest";

import type { IdentityProofVerifier } from "@ii-tonya/application";
import {
  ClientProofUnavailableError,
  createClientProofVerifierGate,
} from "./client-proof-verifier-gate.js";

const input = (signal = new AbortController().signal) => ({
  identityProof: "P".repeat(32),
  expectedAudience: "ii-tonya-client" as const,
  expectedScope: "client_session:create" as const,
  signal,
});

describe("client proof verifier gate", () => {
  it("aborts a hanging verifier at the deadline and exposes no cause", async () => {
    vi.useFakeTimers();
    let verifierSignal: AbortSignal | undefined;
    const verifier: IdentityProofVerifier = {
      verify: vi.fn(async (request) => {
        verifierSignal = request.signal;
        return await new Promise(() => undefined);
      }),
    };
    const gate = createClientProofVerifierGate(verifier, {
      timeoutMs: 2_000,
      maximumConcurrent: 32,
    });
    const pending = gate.verify(input());
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).rejects.toEqual(
      new ClientProofUnavailableError(),
    );
    expect(verifierSignal?.aborted).toBe(true);
    expect(JSON.stringify(await pending.catch((error) => error))).not.toContain(
      "P".repeat(32),
    );
    vi.useRealTimers();
  });

  it("rejects the 33rd in-flight call without invoking the verifier", async () => {
    const releases: Array<() => void> = [];
    const verifier: IdentityProofVerifier = {
      verify: vi.fn(
        async () =>
          await new Promise<null>((resolve) => releases.push(() => resolve(null))),
      ),
    };
    const gate = createClientProofVerifierGate(verifier, {
      timeoutMs: 60_000,
      maximumConcurrent: 32,
    });
    const pending = Array.from({ length: 32 }, () => gate.verify(input()));

    await expect(gate.verify(input())).rejects.toBeInstanceOf(
      ClientProofUnavailableError,
    );
    expect(verifier.verify).toHaveBeenCalledTimes(32);
    releases.forEach((release) => release());
    await Promise.all(pending);
  });

  it("propagates caller cancellation and discards a late completion", async () => {
    let release!: () => void;
    const verifier: IdentityProofVerifier = {
      verify: async () =>
        await new Promise<null>((resolve) => {
          release = () => resolve(null);
        }),
    };
    const controller = new AbortController();
    const gate = createClientProofVerifierGate(verifier, {
      timeoutMs: 60_000,
      maximumConcurrent: 32,
    });
    const pending = gate.verify(input(controller.signal));
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ClientProofUnavailableError);
    release();
    await Promise.resolve();
  });
});
