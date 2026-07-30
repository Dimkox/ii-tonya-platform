import { describe, expect, it } from "vitest";
import {
  canonicalAdminPayload,
  canonicalAdminPayloadHash,
} from "./admin-approval-repository.js";

describe("admin approval canonical payload", () => {
  it("hashes semantically identical payloads identically regardless of key order", () => {
    const first = {
      units: 500,
      target: { userId: "u-1", package: { kind: "admin", expiresInDays: 60 } },
      flags: ["audited", "immutable"],
    };
    const reordered = {
      flags: ["audited", "immutable"],
      target: { package: { expiresInDays: 60, kind: "admin" }, userId: "u-1" },
      units: 500,
    };

    expect(canonicalAdminPayload(first)).toBe(
      '{"flags":["audited","immutable"],"target":{"package":{"expiresInDays":60,"kind":"admin"},"userId":"u-1"},"units":500}',
    );
    expect(canonicalAdminPayloadHash(first)).toBe(
      canonicalAdminPayloadHash(reordered),
    );
  });

  it("rejects undefined, non-finite numbers, and non-plain objects", () => {
    expect(() => canonicalAdminPayload({ value: undefined })).toThrow(
      "Unsupported admin payload value",
    );
    expect(() => canonicalAdminPayload({ value: Number.NaN })).toThrow(
      "Unsupported admin payload number",
    );
    expect(() => canonicalAdminPayload(
      { value: new Date() } as unknown as Parameters<typeof canonicalAdminPayload>[0],
    )).toThrow(
      "Unsupported admin payload object",
    );
  });
});
