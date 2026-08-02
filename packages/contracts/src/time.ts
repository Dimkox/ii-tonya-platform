export interface Clock {
  now(): Date;
}

export const toUtcIso = (value: Date): string => value.toISOString();
