import { describe, expect, it, vi } from "vitest";

import {
  WaitlistConflictError,
  WaitlistInvalidRequestError,
  createWaitlistService,
} from "./waitlist-service.js";

const userId = "00000000-0000-4000-8000-000000000101";
const choiceHandle = `ch1.${"A".repeat(43)}` as const;
const waitlistHandle = `wl1.${"B".repeat(43)}` as const;

describe("waitlist application boundary", () => {
  it("derives authority and a stable command from the authenticated principal", async () => {
    const join = vi.fn(async () => ({
      kind: "joined" as const,
      waitlistHandle,
      position: 2,
    }));
    const service = createWaitlistService({
      repository: { join, leave: vi.fn() },
      generateHandle: () => waitlistHandle,
      newCorrelationId: () => "join-correlation",
    });

    await expect(
      service.join(
        { authenticated: true, active: true, userId },
        { choiceHandle },
      ),
    ).resolves.toEqual({ waitlistHandle, position: 2, replayed: false });
    expect(join).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        waitlistHandle,
        correlationId: "join-correlation",
        holdDurationMs: 72 * 60 * 60 * 1_000,
      }),
    );
  });

  it("rejects hostile principals and malformed public handles before repository access", async () => {
    const repository = { join: vi.fn(), leave: vi.fn() };
    const service = createWaitlistService({ repository });
    await expect(
      service.join({ authenticated: false } as never, { choiceHandle }),
    ).rejects.toBeInstanceOf(WaitlistInvalidRequestError);
    await expect(
      service.leave(
        { authenticated: true, active: true, userId },
        `${waitlistHandle}x`,
      ),
    ).rejects.toBeInstanceOf(WaitlistInvalidRequestError);
    expect(repository.join).not.toHaveBeenCalled();
    expect(repository.leave).not.toHaveBeenCalled();
  });

  it("normalizes repository conflicts and preserves replay semantics", async () => {
    const service = createWaitlistService({
      repository: {
        join: vi
          .fn()
          .mockResolvedValueOnce({
            kind: "replayed",
            waitlistHandle,
            position: 1,
          })
          .mockResolvedValueOnce({ kind: "conflict" }),
        leave: vi.fn(async () => ({ kind: "replayed" as const })),
      },
      generateHandle: () => waitlistHandle,
    });
    const principal = {
      authenticated: true as const,
      active: true as const,
      userId,
    };
    await expect(
      service.join(principal, { choiceHandle }),
    ).resolves.toMatchObject({
      replayed: true,
    });
    await expect(
      service.join(principal, { choiceHandle }),
    ).rejects.toBeInstanceOf(WaitlistConflictError);
    await expect(service.leave(principal, waitlistHandle)).resolves.toEqual({
      waitlistHandle,
      state: "cancelled",
      replayed: true,
    });
  });
});
