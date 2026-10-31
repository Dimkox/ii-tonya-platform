import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  LAUNCH_KIT_BANNER,
  LAUNCH_KIT_DIGEST,
  LAUNCH_KIT_POSTS,
  LAUNCH_KIT_VERSION,
  launchKitMessage,
} from "./early-bird-launch-kit-content.js";
it("ships the exact original SVG and two neutral versioned post templates", () => {
  expect(LAUNCH_KIT_BANNER).toBe(
    readFileSync("assets/early-bird/launch-kit-v1/banner.svg", "utf8"),
  );
  expect(LAUNCH_KIT_POSTS).toHaveLength(2);
  expect(LAUNCH_KIT_BANNER).toContain("11 января 2027");
  expect(LAUNCH_KIT_BANNER).not.toMatch(
    /<\s*script\b|<\s*foreignObject\b|href\s*=|\son[a-z]+\s*=|url\(/iu,
  );
  const digest = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        version: LAUNCH_KIT_VERSION,
        text: launchKitMessage(),
        bannerSvg: LAUNCH_KIT_BANNER,
      }),
    )
    .digest("hex")}`;
  expect(digest).toBe(LAUNCH_KIT_DIGEST);
  expect(
    readFileSync(
      "docs/superpowers/implementation-artifacts/drafts/early_bird_launch_kit.sql",
      "utf8",
    ),
  ).toContain(digest);
  expect(launchKitMessage().length).toBeLessThan(4096);
});
