import type {
  PlanerkaMutationOutcome,
  PlanerkaPort,
  ProviderSlot,
} from "./planerka-port.js";

const disabled = (): never => {
  throw new Error("Planerka integration is disabled");
};

export class DisabledPlanerkaAdapter implements PlanerkaPort {
  async listSlots(window: {
    from: string;
    to: string;
  }): Promise<readonly ProviderSlot[]> {
    void window;
    return disabled();
  }

  async reserve(command: {
    idempotencyKey: string;
    externalSlotId: string;
    externalReservationId: string;
  }): Promise<PlanerkaMutationOutcome> {
    void command;
    return disabled();
  }

  async confirm(command: {
    idempotencyKey: string;
    externalReservationId: string;
  }): Promise<PlanerkaMutationOutcome> {
    void command;
    return disabled();
  }

  async cancel(command: {
    idempotencyKey: string;
    externalReservationId: string;
  }): Promise<PlanerkaMutationOutcome> {
    void command;
    return disabled();
  }

  async getReservation(
    externalReservationId: string,
  ): Promise<"reserved" | "booked" | "cancelled" | "missing"> {
    void externalReservationId;
    return disabled();
  }
}
