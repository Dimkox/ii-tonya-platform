export type UserId = string & { readonly __brand: "UserId" };
export type ReservationId = string & { readonly __brand: "ReservationId" };
export type EventId = string & { readonly __brand: "EventId" };

type Brand = UserId | ReservationId | EventId;

export const brandId = <T extends Brand>(value: string): T => value as T;
