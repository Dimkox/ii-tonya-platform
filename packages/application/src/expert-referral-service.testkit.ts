import type {
  ExpertPrincipal,
  ReferralSummary,
} from "./expert-referral-service.js";

export const owner: ExpertPrincipal = {
  authenticated: true,
  userId: "user-1",
  expertId: "expert-1",
};
export const otherExpert: ExpertPrincipal = {
  authenticated: true,
  userId: "user-2",
  expertId: "expert-1",
};
export const referralSummary: ReferralSummary = {
  availableMinor: "100000",
  reservedMinor: "0",
  debtMinor: "0",
  nearestExpiry: null,
};
