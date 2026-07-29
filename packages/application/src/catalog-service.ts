export interface CatalogEligibilityQuery {
  readonly serviceCode?: string;
  readonly language?: string;
  readonly from: Date;
  readonly to: Date;
  readonly now: Date;
  readonly minimumLeadMs: number;
  readonly requireExpertActive: true;
  readonly requireExpertVerified: true;
  readonly requireServiceActive: true;
}

export interface CatalogExpertRecord {
  readonly expertId: string;
  readonly displayName: string;
  readonly serviceCode: string;
  readonly language: string;
  readonly slotId: string;
  readonly slotStartsAt: Date;
}

export interface CatalogRepository {
  findEligible(
    input: CatalogEligibilityQuery,
  ): Promise<readonly CatalogExpertRecord[]>;
}

export interface CatalogExpertView {
  readonly expertId: string;
  readonly displayName: string;
  readonly serviceCode: string;
  readonly language: string;
  readonly slots: readonly {
    readonly slotId: string;
    readonly startsAt: string;
  }[];
}

export interface CatalogService {
  search(command: {
    readonly serviceCode?: string;
    readonly language?: string;
    readonly from: Date;
    readonly to: Date;
    readonly now: Date;
  }): Promise<readonly CatalogExpertView[]>;
}

const MINIMUM_LEAD_MS = 24 * 60 * 60 * 1_000;

const finiteDate = (value: Date): boolean =>
  value instanceof Date && Number.isFinite(value.getTime());

export const createCatalogService = (deps: {
  readonly repository: CatalogRepository;
}): CatalogService => ({
  async search(command) {
    if (
      !finiteDate(command.from) ||
      !finiteDate(command.to) ||
      !finiteDate(command.now) ||
      command.from.getTime() >= command.to.getTime()
    ) {
      throw new Error("Invalid catalog search range");
    }

    const records = await deps.repository.findEligible({
      ...command,
      minimumLeadMs: MINIMUM_LEAD_MS,
      requireExpertActive: true,
      requireExpertVerified: true,
      requireServiceActive: true,
    });
    const grouped = new Map<string, CatalogExpertView>();
    for (const record of records) {
      if (!finiteDate(record.slotStartsAt)) {
        throw new Error("Catalog repository returned an invalid slot");
      }
      const key = [
        record.expertId,
        record.serviceCode,
        record.language,
      ].join(":");
      const slot = {
        slotId: record.slotId,
        startsAt: record.slotStartsAt.toISOString(),
      };
      const existing = grouped.get(key);
      grouped.set(
        key,
        existing === undefined
          ? {
              expertId: record.expertId,
              displayName: record.displayName,
              serviceCode: record.serviceCode,
              language: record.language,
              slots: [slot],
            }
          : { ...existing, slots: [...existing.slots, slot] },
      );
    }

    return [...grouped.values()]
      .map((expert) => ({
        ...expert,
        slots: [...expert.slots].sort(
          (left, right) =>
            left.startsAt.localeCompare(right.startsAt) ||
            left.slotId.localeCompare(right.slotId),
        ),
      }))
      .sort(
        (left, right) =>
          left.expertId.localeCompare(right.expertId) ||
          left.serviceCode.localeCompare(right.serviceCode) ||
          left.language.localeCompare(right.language),
      );
  },
});
