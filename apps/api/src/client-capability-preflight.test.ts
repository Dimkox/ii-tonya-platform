import { describe, expect, it } from "vitest";

import { assertClientCapabilityPreflight } from "./client-capability-preflight.js";

describe("client capability preflight", () => {
  it.each([
    [{ clientSession: false, clientCatalog: false }, false, undefined],
    [{ clientSession: true, clientCatalog: false }, true, undefined],
    [{ clientSession: false, clientCatalog: true }, false, "Client catalog requires client session authority"],
    [{ clientSession: true, clientCatalog: true }, false, "Client session verifier capability is required"],
  ] as const)("validates flags before database work", (features, verifier, error) => {
    const invoke = () => assertClientCapabilityPreflight(features, { identityProofVerifier: verifier });
    if (error === undefined) expect(invoke).not.toThrow();
    else expect(invoke).toThrow(error);
  });
});
