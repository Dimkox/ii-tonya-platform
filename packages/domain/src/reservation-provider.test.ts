import { expect, it } from "vitest";
import { transitionReservation } from "./reservation.js";
it("expert approval retains local occupancy without claiming provider success", () => {
  expect(transitionReservation("reserved", "expert_confirm")).toBe("reserved");
});
