import type { ResidentFormInput } from "@ii-tonya/application";
import type {
  PostgresDeferredOnboardingStatus,
  PostgresDeferredScopeSource,
} from "@ii-tonya/db";
/** Authenticated status projection for a deferred expert; it grants no payment authority. */
export class EarlyBirdDeferredStatus {
  constructor(
    private readonly scope: PostgresDeferredScopeSource,
    private readonly status: PostgresDeferredOnboardingStatus,
  ) {}
  async current(
    input: ResidentFormInput,
  ): Promise<{
    id: string;
    revision: number;
    status: "ONBOARDING_ONLY";
    baseMonthlyMinor: string;
  } | null> {
    const scope = await this.scope.resolveCurrent(input);
    if (!scope) return null;
    const identity = await this.scope.resolve(scope);
    if (!identity) return null;
    const status = await this.status.find(identity.userId);
    if (!status || status.baseId !== scope.offerId) return null;
    return {
      id: scope.offerId,
      revision: scope.revision,
      status: status.status,
      baseMonthlyMinor: status.basePriceMinor.toString(),
    };
  }
}
