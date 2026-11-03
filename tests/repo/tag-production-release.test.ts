import { describe, expect, it } from "vitest";
import {
  parseArgs,
  releaseNotes,
  releaseTag,
} from "../../scripts/tag-production-release.mjs";

const SHA = "2220f523b7ce66ccda4df74c2715c2f937304594";

describe("tag-production-release", () => {
  it("derives prod-<8 hex> tags from full SHAs only", () => {
    expect(releaseTag(SHA)).toBe("prod-2220f523");
    expect(() => releaseTag("2220f523")).toThrow(/full 40-char/);
    expect(() => releaseTag(SHA.toUpperCase())).toThrow();
  });

  it("requires a date and keeps the live check on by default", () => {
    expect(() => parseArgs([SHA])).toThrow(/--date/);
    expect(parseArgs([SHA, "--date", "2026-10-27"])).toMatchObject({
      sha: SHA,
      liveCheck: true,
      host: "ii-tonya.ru",
    });
    expect(
      parseArgs([SHA, "--date", "2026-10-27", "--skip-live-check"]).liveCheck,
    ).toBe(false);
    expect(() => parseArgs([SHA, "--date", "2026-10-27", "--bogus"])).toThrow(
      /unknown/,
    );
  });

  it("records the live SOURCE_SHA and evidence in notes", () => {
    const notes = releaseNotes({
      sha: SHA,
      date: "2026-10-27",
      host: "ii-tonya.ru",
      evidence: "docs/x.md",
      liveSha: SHA,
    });
    expect(notes).toContain(`/SOURCE_SHA\` = \`${SHA}\``);
    expect(notes).toContain("docs/x.md");
    expect(releaseNotes({ sha: SHA, date: "2026-10-27", host: "h" })).toContain(
      "пропущена",
    );
  });
});
