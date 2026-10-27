interface PresentationEvidence {
  id: string;
  createdAt: string;
  consumedAt: string | null;
}

/** Normalize the owner-bound presentation selected by the export query. */
export function projectConsentPresentation(
  presentation: PresentationEvidence | null,
): PresentationEvidence | null {
  if (presentation === null) return null;
  const createdAt = new Date(presentation.createdAt);
  const consumedAt =
    presentation.consumedAt === null ? null : new Date(presentation.consumedAt);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    (consumedAt !== null && !Number.isFinite(consumedAt.getTime()))
  )
    return null;
  return {
    id: presentation.id,
    createdAt: createdAt.toISOString(),
    consumedAt: consumedAt === null ? null : consumedAt.toISOString(),
  };
}
