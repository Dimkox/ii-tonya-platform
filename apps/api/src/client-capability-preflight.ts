interface ClientFeatureFlags {
  readonly clientSession?: boolean;
  readonly clientCatalog?: boolean;
  readonly clientBooking?: boolean;
  readonly clientBookingReserve?: boolean;
  readonly workerOutboxDelivery?: boolean;
}

interface ClientCapabilities {
  readonly identityProofVerifier: boolean;
  readonly bookingRuntime?: boolean;
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
  if (
    features.clientBookingReserve === true &&
    features.clientBooking !== true
  ) {
    throw new Error("Client booking reserve requires client booking routes");
  }
  if (
    features.clientBooking === true &&
    (features.clientSession !== true || features.clientCatalog !== true)
  ) {
    throw new Error("Client booking requires session and catalog authority");
  }
  if (
    features.clientBooking === true &&
    features.workerOutboxDelivery !== true
  ) {
    throw new Error("Client booking requires catalog worker delivery");
  }
  if (features.clientBooking === true && capabilities.bookingRuntime !== true) {
    throw new Error("Client booking runtime capability is required");
  }
};
