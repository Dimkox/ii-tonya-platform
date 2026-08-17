import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CLIENT_CATALOG_OUTBOX_TOPICS } from "../../packages/contracts/src/worker-outbox.js";

const root = process.cwd();
const bookingTopics = [
  "planerka.reserve",
  "planerka.cancel",
  "telegram.reservation_request",
  "telegram.booking_cancelled",
];

describe("client booking provider isolation", () => {
  it("keeps every booking topic outside the only worker claim allowlist", () => {
    for (const topic of bookingTopics) {
      expect(CLIENT_CATALOG_OUTBOX_TOPICS).not.toContain(topic);
    }
  });

  it("keeps route and application code free of provider/network adapters", () => {
    const source = [
      "packages/application/src/client-booking-service.ts",
      "apps/api/src/routes/client-booking.ts",
      "apps/api/src/client-booking-principal-resolver.ts",
    ]
      .map((file) => readFileSync(join(root, file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/Planerka|Telegram|fetch\(|https?:\/\//u);
    expect(source).not.toMatch(/amount|payment|contact|providerId/u);
  });
});
