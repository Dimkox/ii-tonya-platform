interface ClientFeatureFlags {
  readonly clientSession?: boolean;
  readonly clientCatalog?: boolean;
}

interface ClientCapabilities {
  readonly identityProofVerifier: boolean;
}

export const assertClientCapabilityPreflight = (
  features: ClientFeatureFlags,
  capabilities: ClientCapabilities,
): void => {
  if (features.clientCatalog === true && features.clientSession !== true) {
    throw new Error("Client catalog requires client session authority");
  }
  if (
    features.clientSession === true &&
    capabilities.identityProofVerifier !== true
  ) {
    throw new Error("Client session verifier capability is required");
  }
};
