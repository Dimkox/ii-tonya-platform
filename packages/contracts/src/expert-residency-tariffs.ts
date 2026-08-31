export const EXPERT_RESIDENCY_V2_TARIFFS = {
  START: {
    displayName: "Старт",
    priceMinor: 390000,
    groupEventLimit: 0,
    statisticsLevel: "basic",
    supportPriority: "standard",
  },
  BASE: {
    displayName: "База",
    priceMinor: 590000,
    groupEventLimit: 1,
    statisticsLevel: "expanded",
    supportPriority: "standard",
  },
  PRO: {
    displayName: "Про",
    priceMinor: 999000,
    groupEventLimit: 3,
    statisticsLevel: "expanded",
    supportPriority: "priority",
  },
} as const;

export type ExpertResidencyV2TariffKey =
  keyof typeof EXPERT_RESIDENCY_V2_TARIFFS;
