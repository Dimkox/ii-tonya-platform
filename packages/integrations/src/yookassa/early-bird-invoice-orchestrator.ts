import { buildEarlyBirdOwnerRequest } from "./early-bird-request.js";

type Source = Parameters<typeof buildEarlyBirdOwnerRequest>[0];
type Request = ReturnType<typeof buildEarlyBirdOwnerRequest>;
type Outcome = { kind: "unavailable" | "cancelled" | "unknown" | "started" };

/**
 * These are authority boundaries, not proof that a particular implementation is
 * safe. Production composition must supply independently reviewed implementations.
 * The authority must atomically validate the current grant, qualification, consent,
 * dates and exact immutable intent, then encrypt/persist the exact request; repeated
 * calls must never replace it. The gateway must retrieve only that persisted request,
 * provide the erasure/first-send fence, and durably prevent uncertain sends from
 * being retried. A process-local lock or queued request is not such a fence.
 */
export interface EarlyBirdInvoiceDependencies {
  authority: {
    prepare(userId: string): Promise<Source | null>;
    persist(
      request: Request & { userId: string; operationId: string },
    ): Promise<boolean>;
  };
  gateway: {
    dispatch(identity: {
      userId: string;
      operationId: string;
    }): Promise<Outcome>;
  };
}

/** Disabled unless both authority and strict gateway are explicitly composed. */
export async function createEarlyBirdInvoice(
  dependencies: EarlyBirdInvoiceDependencies | null,
  userId: string,
): Promise<Outcome> {
  if (!dependencies) return { kind: "unavailable" };
  let source: Source | null;
  try {
    source = await dependencies.authority.prepare(userId);
    if (!source || source.intent.userId !== userId)
      return { kind: "unavailable" };
    const request = buildEarlyBirdOwnerRequest(source);
    if (
      !(await dependencies.authority.persist({
        ...request,
        userId,
        operationId: source.intent.operationId,
      }))
    )
      return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
  try {
    return await dependencies.gateway.dispatch({
      userId,
      operationId: source.intent.operationId,
    });
  } catch {
    // A gateway exception may occur after the provider received the request.
    return { kind: "unknown" };
  }
}
