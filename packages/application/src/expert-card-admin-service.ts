export interface PublicExpertCard {
  displayName: string;
  profession: string;
  city: string;
  summary: string;
}
type Command = {
  sessionHash: string;
  applicationId: string;
  expectedRevision: number;
  idempotencyKey: string;
};
export interface ExpertCardAdminRepository {
  listDrafts(sessionHash: string, limit?: number): Promise<readonly unknown[]>;
  readDraft(
    sessionHash: string,
    applicationId: string,
  ): Promise<unknown | null>;
  editPublicCard(
    input: Command & { publicCard: PublicExpertCard },
  ): Promise<unknown>;
  reviewCard(
    input: Command & {
      action: "approve" | "return_changes";
      warningAcknowledgment?: string;
    },
  ): Promise<unknown>;
  confirmPromo(input: Command): Promise<unknown>;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: object, expected: string[]) =>
  Object.keys(v).sort().join(",") === expected.sort().join(",");
const failure = (e: unknown) => {
  const c = e instanceof Error ? e.message : "";
  return {
    kind:
      c === "card_forbidden" || c === "verification_forbidden"
        ? "forbidden"
        : [
              "card_revision_conflict",
              "card_state_conflict",
              "card_idempotency_conflict",
            ].includes(c)
          ? "conflict"
          : [
                "card_invalid_event",
                "card_invalid_entry",
                "card_invalid_public_payload",
                "card_invalid_proof",
              ].includes(c)
            ? "invalid"
            : "unavailable",
  } as { kind: "forbidden" | "conflict" | "invalid" | "unavailable" };
};
export function createExpertCardAdminService(deps: {
  enabled: boolean;
  repository: ExpertCardAdminRepository;
}) {
  const authorize = (session: string) =>
    !deps.enabled
      ? { kind: "disabled" as const }
      : !/^sha256:[a-f0-9]{64}$/u.test(session)
        ? { kind: "forbidden" as const }
        : undefined;
  const command = (
    sessionHash: string,
    input: unknown,
    extra: string[],
  ): Command | null => {
    if (
      !object(input) ||
      !keys(input, [
        "applicationId",
        "expectedRevision",
        "idempotencyKey",
        ...extra,
      ]) ||
      typeof input.applicationId !== "string" ||
      !uuid.test(input.applicationId) ||
      typeof input.expectedRevision !== "number" ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.expectedRevision > 2147483647 ||
      typeof input.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey)
    )
      return null;
    return {
      sessionHash,
      applicationId: input.applicationId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    };
  };
  return {
    async list(sessionHash: string, input: { limit?: number }) {
      const denied = authorize(sessionHash);
      if (denied) return denied;
      const limit = input.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        return { kind: "invalid" as const };
      try {
        return {
          kind: "ok" as const,
          items: await deps.repository.listDrafts(sessionHash, limit),
        };
      } catch (e) {
        return failure(e);
      }
    },
    async detail(sessionHash: string, id: string) {
      const denied = authorize(sessionHash);
      if (denied) return denied;
      if (!uuid.test(id)) return { kind: "invalid" as const };
      try {
        const item = await deps.repository.readDraft(sessionHash, id);
        return item
          ? { kind: "ok" as const, item }
          : { kind: "not_found" as const };
      } catch (e) {
        return failure(e);
      }
    },
    async edit(
      sessionHash: string,
      input: Omit<Command, "sessionHash"> & { publicCard: PublicExpertCard },
    ) {
      const denied = authorize(sessionHash);
      if (denied) return denied;
      const base = command(sessionHash, input, ["publicCard"]);
      if (!base) return { kind: "invalid" as const };
      const card = input.publicCard;
      if (
        !base ||
        !object(card) ||
        !keys(card, ["displayName", "profession", "city", "summary"])
      )
        return { kind: "invalid" as const };
      const caps = {
        displayName: 80,
        profession: 120,
        city: 80,
        summary: 2000,
      };
      for (const k of Object.keys(caps) as (keyof PublicExpertCard)[]) {
        if (
          typeof card[k] !== "string" ||
          card[k].trim().length < 1 ||
          card[k].trim().length > caps[k] ||
          /[\u0000-\u001f\u007f-\u009f]/u.test(card[k])
        )
          return { kind: "invalid" as const };
      }
      const publicCard = {
        displayName: card.displayName.trim(),
        profession: card.profession.trim(),
        city: card.city.trim(),
        summary: card.summary.trim(),
      };
      try {
        return {
          kind: "ok" as const,
          item: await deps.repository.editPublicCard({ ...base, publicCard }),
        };
      } catch (e) {
        return failure(e);
      }
    },
    async review(
      sessionHash: string,
      input: Omit<Command, "sessionHash"> & {
        action: "approve" | "return_changes";
        warningAcknowledgment?: string;
      },
    ) {
      const denied = authorize(sessionHash);
      if (denied) return denied;
      const base = command(sessionHash, input, [
        "action",
        ...(input.warningAcknowledgment === undefined
          ? []
          : ["warningAcknowledgment"]),
      ]);
      if (
        input.warningAcknowledgment !== undefined &&
        (typeof input.warningAcknowledgment !== "string" ||
          !/^[0-9a-f]{64}$/u.test(input.warningAcknowledgment))
      )
        return { kind: "invalid" as const };
      if (!base || !["approve", "return_changes"].includes(input.action))
        return { kind: "invalid" as const };
      try {
        return {
          kind: "ok" as const,
          item: await deps.repository.reviewCard({
            ...base,
            action: input.action,
            ...(input.warningAcknowledgment === undefined
              ? {}
              : { warningAcknowledgment: input.warningAcknowledgment }),
          }),
        };
      } catch (e) {
        return failure(e);
      }
    },
    async confirmPromo(
      sessionHash: string,
      input: Omit<Command, "sessionHash">,
    ) {
      const denied = authorize(sessionHash);
      if (denied) return denied;
      const base = command(sessionHash, input, []);
      if (!base) return { kind: "invalid" as const };
      try {
        return {
          kind: "ok" as const,
          item: await deps.repository.confirmPromo(base),
        };
      } catch (e) {
        return failure(e);
      }
    },
  };
}
export type ExpertCardAdminService = ReturnType<
  typeof createExpertCardAdminService
>;
