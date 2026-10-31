import type { EarlyBirdPrepareAuthority } from "./expert-early-bird-prepare-hook.js";
/** Both resolvers must enforce their DB grant policy. Owner source never falls back to standard pricing. */
export function combineEarlyBirdNowAuthorities(
  owner: EarlyBirdPrepareAuthority,
  standard: EarlyBirdPrepareAuthority,
): EarlyBirdPrepareAuthority {
  return {
    async prepare(input) {
      const result = await owner.prepare(input);
      return result.kind === "unavailable" ? standard.prepare(input) : result;
    },
  };
}

import type { EarlyBirdSalesAuthority } from "./expert-early-bird-service.js";
type ReceiptAuthority = Required<
  Pick<EarlyBirdSalesAuthority, "captureReceipt">
>;
/** Receipt ownership is independently resolved by each DB source. */
export function combineEarlyBirdNowReceiptAuthorities(
  owner: ReceiptAuthority,
  standard: ReceiptAuthority,
): ReceiptAuthority {
  return {
    async captureReceipt(input, email) {
      const result = await owner.captureReceipt(input, email);
      return result || standard.captureReceipt(input, email);
    },
  };
}
