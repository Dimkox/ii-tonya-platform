import { describe, expect, it } from "vitest";
import { EarlyBirdLaunchConfigAuthority } from "./early-bird-launch-config.js";
const id = "ebfef060-efc9-4211-9266-ff856ce5c120";
const tx = (phase: string, inWindow: boolean) => {
  let calls = 0;
  return {
    execute: async () =>
      ++calls === 1
        ? {
            rows: [
              {
                id,
                phase,
                trigger_ms: "1798441200000",
                client_start_ms: "1799614800000",
              },
            ],
          }
        : { rows: [{ in_window: inWindow }] },
  } as never;
};
describe("launch config authority", () => {
  it("returns the locked database generation and the effective wave phase", async () => {
    expect(
      await new EarlyBirdLaunchConfigAuthority().lockCurrentState(
        tx("WAVE_1_EARLY_BIRD", true),
      ),
    ).toEqual({
      version: id,
      phase: "WAVE_1_EARLY_BIRD",
      triggerAtMs: 1798441200000,
      clientStartAtMs: 1799614800000,
    });
  });
  it("retains the generation when public or outside the wave", async () => {
    const a = new EarlyBirdLaunchConfigAuthority();
    expect(await a.lockCurrentState(tx("WAVE_1_EARLY_BIRD", false))).toEqual({
      version: id,
      triggerAtMs: 1798441200000,
      clientStartAtMs: 1799614800000,
      phase: "PUBLIC_LAUNCH",
    });
    expect(await a.lockCurrent(tx("PUBLIC_LAUNCH", true))).toBe(id);
  });
  it("fails closed for an absent or malformed current generation", async () => {
    const a = new EarlyBirdLaunchConfigAuthority();
    expect(
      await a.lockCurrent({ execute: async () => ({ rows: [] }) } as never),
    ).toBeNull();
    await expect(
      a.lockCurrent({
        execute: async () => ({
          rows: [{ id: "invalid", phase: "PUBLIC_LAUNCH" }],
        }),
      } as never),
    ).rejects.toThrow("early_bird_launch_config_invalid");
  });
});
