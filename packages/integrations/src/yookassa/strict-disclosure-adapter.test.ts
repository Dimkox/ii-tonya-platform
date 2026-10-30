import { describe, expect, it } from "vitest";
import { StrictDisclosureGate } from "./strict-disclosure-gate.js";
import { StrictDisclosureAdapter } from "./strict-disclosure-adapter.js";

describe("strict disclosure adapter", () => {
  it("cancels a pending send when an erasure begins during authorization", async () => {
    const gate = new StrictDisclosureGate();
    let release!: () => void;
    let started = false;
    let erased = false;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new StrictDisclosureAdapter(gate, {
      authorize: async () => {
        await barrier;
      },
      start: () => {
        started = true;
        return Promise.resolve();
      },
      erase: async () => {
        erased = true;
      },
    });
    const pending = adapter.send("subject");
    await adapter.erase("subject");
    release();
    expect(await pending).toBe("cancelled");
    expect(erased).toBe(true);
    expect(started).toBe(false);
  });

  it("keeps sends blocked if erasure persistence fails", async () => {
    let started = false;
    const adapter = new StrictDisclosureAdapter(new StrictDisclosureGate(), {
      authorize: async () => {},
      start: () => {
        started = true;
        return Promise.resolve();
      },
      erase: async () => {
        throw new Error("storage_failed");
      },
    });
    await expect(adapter.erase("subject")).rejects.toThrow("storage_failed");
    expect(await adapter.send("subject")).toBe("cancelled");
    expect(started).toBe(false);
  });
});
