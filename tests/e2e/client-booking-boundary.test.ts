import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseClientBookingBody } from "../../apps/api/src/client-booking-body.js";

const choiceHandle = `ch1.${"B".repeat(43)}`;

describe("client booking raw HTTP boundary", () => {
  it("accepts one valid de-framed chunked JSON entity", () => {
    const body = Buffer.from(JSON.stringify({ choiceHandle }));
    expect(
      parseClientBookingBody({
        body,
        contentType: "application/json",
        transferEncoding: "chunked",
      }),
    ).toEqual({ choiceHandle });
    expect(
      parseClientBookingBody({
        body,
        contentType: "application/json",
        transferEncoding: "gzip, chunked",
      }),
    ).toBeNull();
    expect(
      parseClientBookingBody({
        body,
        contentType: "application/json",
        transferEncoding: "chunked",
        contentLength: String(body.byteLength),
      }),
    ).toBeNull();
  });

  it("requires a literal canonical booking handle in the raw DELETE path", () => {
    const routes = readFileSync(
      "apps/api/src/routes/client-booking.ts",
      "utf8",
    );
    expect(routes).toContain(
      "^\\/v1\\/client\\/bookings\\/(bk1\\.[A-Za-z0-9_-]{43})$",
    );
    expect(routes).toContain("request.raw.url");
    expect(routes).toContain("rawPath[1]!");
  });
});
