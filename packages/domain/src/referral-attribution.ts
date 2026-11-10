/**
 * Owner rule: a referred person is attributed once, to the first inviter.
 * A later code or link does not move attribution, bonuses, or coupons.
 * The promo-bot PDF counts only a new visitor: someone who had not started
 * the bot and had not been attributed to another inviter.
 */
export type ReferralAttribution =
  | { kind: "self" }
  | { kind: "created"; inviterId: string }
  | { kind: "kept"; inviterId: string | null }
  | { kind: "ignored_late_start" };

export function decideFirstAttribution(input: {
  referredId: string;
  requestedInviterId: string | null;
  existingInviterId: string | null;
  alreadyRegistered: boolean;
  priorStartWithoutCode: boolean;
}): ReferralAttribution {
  if (
    input.requestedInviterId !== null &&
    input.requestedInviterId === input.referredId
  ) {
    return { kind: "self" };
  }
  if (input.alreadyRegistered) {
    return { kind: "kept", inviterId: input.existingInviterId };
  }
  if (input.priorStartWithoutCode) {
    return { kind: "ignored_late_start" };
  }
  if (input.requestedInviterId) {
    return { kind: "created", inviterId: input.requestedInviterId };
  }
  return { kind: "kept", inviterId: null };
}
