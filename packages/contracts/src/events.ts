import { z } from "zod";

import type { EventId } from "./ids.js";

export const eventEnvelopeSchema = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(1),
  occurredAt: z.string().regex(/Z$/).datetime(),
  correlationId: z.string().min(1).max(128),
  payload: z.unknown(),
}).strict();

export type EventEnvelope<TType extends string, TPayload> = {
  eventId: EventId;
  eventType: TType;
  occurredAt: string;
  correlationId: string;
  payload: TPayload;
};
