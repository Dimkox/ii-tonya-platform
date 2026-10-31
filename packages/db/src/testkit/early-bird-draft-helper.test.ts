import { describe, expect, it } from "vitest";
import { decideEarlyBirdDraft } from "./early-bird-draft-helper.js";

describe("draft application decision", () => {
  const base = {
    included: true,
    entireFile: true,
    sourceMatches: true,
    canonicalMatches: true,
  };
  it("skips only when the canonical migration is present and verified", () => {
    expect(decideEarlyBirdDraft({ ...base, installed: "verified" })).toBe(
      "skip",
    );
    expect(decideEarlyBirdDraft({ ...base, installed: "absent" })).toBe(
      "apply",
    );
  });
  it("never silently skips drift, mismatched migration, or partial segments", () => {
    expect(() =>
      decideEarlyBirdDraft({ ...base, installed: "mismatch" }),
    ).toThrow();
    expect(() =>
      decideEarlyBirdDraft({
        ...base,
        installed: "verified",
        sourceMatches: false,
      }),
    ).toThrow();
    expect(() =>
      decideEarlyBirdDraft({
        ...base,
        installed: "verified",
        canonicalMatches: false,
      }),
    ).toThrow();
    expect(
      decideEarlyBirdDraft({
        ...base,
        installed: "verified",
        entireFile: false,
      }),
    ).toBe("suffix");
    expect(
      decideEarlyBirdDraft({ ...base, installed: "verified", included: false }),
    ).toBe("apply");
  });
});

it("does not execute a canonical segment when the database records its exact hash", async () => {
  const { applyEarlyBirdDraftIfNeeded } =
    await import("./early-bird-draft-helper.js");
  let calls = 0;
  const db = {
    execute: async () => {
      calls++;
      return {
        rows:
          calls === 1
            ? [{ present: true }]
            : [
                {
                  hash: "4896c3e2482efc27db1578bbb8ede5098796c404faa75cb5d20ff268657a4353",
                },
              ],
      };
    },
  };
  await applyEarlyBirdDraftIfNeeded(
    db,
    "docs/superpowers/implementation-artifacts/drafts/0081_early_bird_composite.sql",
  );
  expect(calls).toBe(2);
});

it("skips the publication draft only for the exact installed 0083 bytes", async () => {
  const { applyEarlyBirdPublicationDraftIfNeeded } =
    await import("./early-bird-draft-helper.js");
  let calls = 0;
  const db = {
    execute: async () => {
      calls++;
      return {
        rows:
          calls === 1
            ? [{ present: true }]
            : [
                {
                  hash: "69427ca04b5b16004764d8cc6c20c061e1fad85b89eed60352f56529048918f7",
                },
              ],
      };
    },
  };
  await applyEarlyBirdPublicationDraftIfNeeded(db);
  expect(calls).toBe(2);
});
