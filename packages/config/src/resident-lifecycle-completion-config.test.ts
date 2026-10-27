import { expect, it } from "vitest";
import { readResidentLifecycleCompletionConfig } from "./resident-lifecycle-completion-config.js";
it("keeps new acquisition and WORK delivery off under old paid-renewal flags", () => {
  expect(readResidentLifecycleCompletionConfig({})).toBeUndefined();
  expect(
    readResidentLifecycleCompletionConfig({
      EXPERT_RESIDENCY_LIFECYCLE_ENABLED: "true",
      EXPERT_RESIDENCY_LIFECYCLE_DELIVERY_ENABLED: "true",
    }),
  ).toBeUndefined();
  expect(
    readResidentLifecycleCompletionConfig({
      EXPERT_CARD_ENABLED: "true",
      RESIDENT_LIFECYCLE_COMPLETION_ENABLED: "true",
    }),
  ).toEqual({ enabled: true, deliveryEnabled: false });
  expect(
    readResidentLifecycleCompletionConfig({
      EXPERT_CARD_ENABLED: "true",
      RESIDENT_WORK_NOTICE_DELIVERY_ENABLED: "true",
    }),
  ).toEqual({ enabled: false, deliveryEnabled: true });
  expect(() =>
    readResidentLifecycleCompletionConfig({
      RESIDENT_WORK_NOTICE_DELIVERY_ENABLED: "true",
    }),
  ).toThrow("resident_lifecycle_card_required");
  expect(() =>
    readResidentLifecycleCompletionConfig({
      RESIDENT_LIFECYCLE_COMPLETION_ENABLED: "1",
    }),
  ).toThrow("resident_lifecycle_configuration_invalid");
});
