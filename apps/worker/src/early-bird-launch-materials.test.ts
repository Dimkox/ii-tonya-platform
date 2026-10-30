import { describe, expect, it } from "vitest";
import {
  EarlyBirdLaunchMaterialsRunner,
  type LaunchMaterialStore,
  type LaunchMaterialSender,
} from "./early-bird-launch-materials.js";

const claim = { jobId: "job", attemptId: "attempt", userId: "user" } as const;
const payload = {
  text: "Материалы",
  assets: [{ kind: "photo" as const, reference: "asset" }],
};

describe("launch material delivery", () => {
  it("does not claim or send without the strict authority capability", async () => {
    let claims = 0;
    const store = {
      claim: async () => {
        claims++;
        return claim;
      },
    } as unknown as LaunchMaterialStore;
    const result = await new EarlyBirdLaunchMaterialsRunner(
      store,
      undefined,
    ).run(10, new AbortController().signal);
    expect(result).toEqual({ delivered: 0, uncertain: 0 });
    expect(claims).toBe(0);
  });
  it("leaves unready content or payment for retry without dispatching", async () => {
    let dispatched = 0,
      outcome = "";
    const store: LaunchMaterialStore = {
      claim: async () => claim,
      prepare: async () => ({ kind: "pending" }),
      dispatch: async () => {
        dispatched++;
        return true;
      },
      finish: async (_claim, result) => {
        outcome = result.kind;
        return true;
      },
    };
    const sender = {
      strictAuthority: true,
      sendIfAuthorized: async () => {
        throw new Error("unexpected");
      },
    } satisfies LaunchMaterialSender;
    await new EarlyBirdLaunchMaterialsRunner(store, sender).run(
      1,
      new AbortController().signal,
    );
    expect(dispatched).toBe(0);
    expect(outcome).toBe("retry");
  });
  it("records the approved content receipt only after durable dispatch", async () => {
    const order: string[] = [];
    const store: LaunchMaterialStore = {
      claim: async () => claim,
      prepare: async () => ({
        kind: "ready",
        candidate: {
          configVersion: "config",
          templateId: "template",
          contentVersion: "v1",
          payloadDigest: "sha256:" + "a".repeat(64),
          payload,
        },
      }),
      dispatch: async () => {
        order.push("dispatch");
        return true;
      },
      finish: async (_claim, result) => {
        order.push(result.kind);
        return true;
      },
    };
    const sender: LaunchMaterialSender = {
      strictAuthority: true,
      sendIfAuthorized: async () => {
        order.push("send");
        return { kind: "delivered", messageIds: ["1", "2"] };
      },
    };
    expect(
      await new EarlyBirdLaunchMaterialsRunner(store, sender).run(
        1,
        new AbortController().signal,
      ),
    ).toEqual({ delivered: 1, uncertain: 0 });
    expect(order).toEqual(["dispatch", "send", "delivered"]);
  });
  it("never treats an ambiguous send or unsaved receipt as delivered", async () => {
    const outcomes: string[] = [];
    const store: LaunchMaterialStore = {
      claim: async () => claim,
      prepare: async () => ({
        kind: "ready",
        candidate: {
          configVersion: "config",
          templateId: "template",
          contentVersion: "v1",
          payloadDigest: "sha256:" + "a".repeat(64),
          payload,
        },
      }),
      dispatch: async () => true,
      finish: async (_claim, result) => {
        outcomes.push(result.kind);
        return false;
      },
    };
    const sender: LaunchMaterialSender = {
      strictAuthority: true,
      sendIfAuthorized: async () => ({
        kind: "delivered",
        messageIds: ["1", "1"],
      }),
    };
    expect(
      await new EarlyBirdLaunchMaterialsRunner(store, sender).run(
        1,
        new AbortController().signal,
      ),
    ).toEqual({ delivered: 0, uncertain: 1 });
    expect(outcomes).toEqual(["uncertain"]);
  });
  it("rejects sparse material assets before dispatch", async () => {
    const assets = new Array<{ kind: "photo"; reference: string }>(1);
    let dispatched = false;
    const store: LaunchMaterialStore = {
      claim: async () => claim,
      prepare: async () => ({
        kind: "ready",
        candidate: {
          configVersion: "config",
          templateId: "template",
          contentVersion: "v1",
          payloadDigest: "sha256:" + "a".repeat(64),
          payload: { text: "Материалы", assets },
        },
      }),
      dispatch: async () => {
        dispatched = true;
        return true;
      },
      finish: async () => true,
    };
    const sender: LaunchMaterialSender = {
      strictAuthority: true,
      sendIfAuthorized: async () => ({ kind: "uncertain" }),
    };
    await new EarlyBirdLaunchMaterialsRunner(store, sender).run(
      1,
      new AbortController().signal,
    );
    expect(dispatched).toBe(false);
  });
});
