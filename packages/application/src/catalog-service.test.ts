import { describe, expect, it, vi } from "vitest";

import { createCatalogService } from "./catalog-service.js";

describe("verified catalog", () => {
  it("returns only allowlisted public fields from repository-eligible experts", async () => {
    const repository = {
      findEligible: vi.fn().mockResolvedValue([
        {
          expertId: "expert-eligible",
          displayName: "Эксперт",
          serviceCode: "consultation",
          language: "ru",
          slotId: "slot-eligible",
          slotStartsAt: new Date("2026-07-30T10:00:00.000Z"),
          privateTelegramId: "must-not-leak",
        },
      ]),
    };

    const result = await createCatalogService({ repository }).search({
      serviceCode: "consultation",
      language: "ru",
      from: new Date("2026-07-30T00:00:00.000Z"),
      to: new Date("2026-08-06T00:00:00.000Z"),
      now: new Date("2026-07-28T10:00:00.000Z"),
    });

    expect(result).toEqual([
      {
        expertId: "expert-eligible",
        displayName: "Эксперт",
        serviceCode: "consultation",
        language: "ru",
        slots: [
          {
            slotId: "slot-eligible",
            startsAt: "2026-07-30T10:00:00.000Z",
          },
        ],
      },
    ]);
    expect(repository.findEligible).toHaveBeenCalledWith(
      expect.objectContaining({
        requireExpertActive: true,
        requireExpertVerified: true,
        requireServiceActive: true,
        minimumLeadMs: 86_400_000,
      }),
    );
  });
});
