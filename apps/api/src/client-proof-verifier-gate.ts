import type { IdentityProofVerifier } from "@ii-tonya/application";

export class ClientProofUnavailableError extends Error {
  constructor() {
    super("client_identity_proof_unavailable");
    this.name = "ClientProofUnavailableError";
  }
}

interface GateOptions {
  readonly timeoutMs?: number;
  readonly maximumConcurrent?: number;
}

export const createClientProofVerifierGate = (
  verifier: IdentityProofVerifier,
  options: GateOptions = {},
): IdentityProofVerifier => {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const maximumConcurrent = options.maximumConcurrent ?? 32;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(maximumConcurrent) ||
    maximumConcurrent < 1
  ) {
    throw new Error("client_identity_proof_gate_invalid");
  }
  let active = 0;

  return Object.freeze({
    async verify(input: Parameters<IdentityProofVerifier["verify"]>[0]) {
      if (active >= maximumConcurrent) {
        throw new ClientProofUnavailableError();
      }
      active += 1;
      const controller = new AbortController();
      let rejectCancellation: (reason: unknown) => void = () => undefined;
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectCancellation = reject;
      });
      const cancel = () => {
        controller.abort();
        rejectCancellation(new ClientProofUnavailableError());
      };
      if (input.signal.aborted) cancel();
      else input.signal.addEventListener("abort", cancel, { once: true });

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new ClientProofUnavailableError());
        }, timeoutMs);
        timeout.unref?.();
      });
      const verification = Promise.resolve()
        .then(() =>
          verifier.verify({
            identityProof: input.identityProof,
            expectedAudience: input.expectedAudience,
            expectedScope: input.expectedScope,
            signal: controller.signal,
          }),
        )
        .catch(() => {
          throw new ClientProofUnavailableError();
        });
      void verification.then(
        () => {
          active -= 1;
        },
        () => {
          active -= 1;
        },
      );

      try {
        return await Promise.race([verification, deadline, cancelled]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        input.signal.removeEventListener("abort", cancel);
      }
    },
  });
};
