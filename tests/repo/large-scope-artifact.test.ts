import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isApprovedLargeScopeArtifact } from "./support/payment-scope-boundary.js";

describe("large scope artifact admission", () => {
  const approved = "packages/db/migrations/state/0075_sql_objects.json";
  const bytes = 1_064_832;

  it("accepts the exact historical catalogue and rejects altered bytes", () => {
    const content = readFileSync(approved, "utf8");
    expect(isApprovedLargeScopeArtifact(approved, bytes, () => content)).toBe(
      true,
    );
    const changed = `${content.slice(0, -1)}${content.endsWith("x") ? "y" : "x"}`;
    expect(isApprovedLargeScopeArtifact(approved, bytes, () => changed)).toBe(
      false,
    );
  });

  it("does not read an unapproved path or unexpected size", () => {
    const read = vi.fn(() => "");
    expect(isApprovedLargeScopeArtifact(approved, bytes + 1, read)).toBe(false);
    expect(
      isApprovedLargeScopeArtifact(
        "packages/db/migrations/state/0076_sql_objects.json",
        bytes,
        read,
      ),
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});
