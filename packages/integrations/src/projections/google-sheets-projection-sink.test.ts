import { describe, expect, it, vi } from "vitest";
import {
  GoogleSheetsProjectionSink,
  googleSheetsProjectionColumns,
  type GoogleSheetsAppendRequest,
} from "./google-sheets-projection-sink.js";
import {
  MakeProjectionPermanentFailure,
  MakeProjectionRetryableFailure,
} from "./make-projection-sink.js";
import type { ProjectionEvent } from "./projection-port.js";

const SPREADSHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const event: ProjectionEvent = {
  eventId: "evt-1",
  topic: "package_balance_projection.v1",
  occurredAt: "2026-11-04T12:00:00.000Z",
  correlationId: "corr-1",
  schemaVersion: 1,
  data: {
    userId: "u1",
    packageId: "p1",
    ledgerDerivedBalance: 3,
    expiresAt: null,
    updatedAt: "2026-11-04T12:00:00.000Z",
  },
};

const sink = (
  status = 200,
  post?: (r: GoogleSheetsAppendRequest) => Promise<{ status: number }>,
) => {
  const calls: GoogleSheetsAppendRequest[] = [];
  return {
    calls,
    sink: new GoogleSheetsProjectionSink({
      spreadsheetId: SPREADSHEET,
      sheetByTopic: { "package_balance_projection.v1": "Балансы" },
      accessToken: () => "token-x",
      post:
        post ??
        (async (r) => {
          calls.push(r);
          return { status };
        }),
    }),
  };
};

describe("GoogleSheetsProjectionSink (SCRUM-507)", () => {
  it("appends one row in fixed column order", async () => {
    const { sink: s, calls } = sink();
    await s.publish(event);
    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.endpoint.origin).toBe("https://sheets.googleapis.com");
    expect(req.endpoint.pathname).toContain(
      `/spreadsheets/${SPREADSHEET}/values/`,
    );
    expect(req.endpoint.searchParams.get("valueInputOption")).toBe("RAW");
    expect(req.headers.Authorization).toBe("Bearer token-x");
    expect(googleSheetsProjectionColumns(event.topic)).toEqual([
      "eventId",
      "topic",
      "occurredAt",
      "correlationId",
      "userId",
      "packageId",
      "ledgerDerivedBalance",
      "expiresAt",
      "updatedAt",
    ]);
    expect(req.body.values).toEqual([
      [
        "evt-1",
        "package_balance_projection.v1",
        "2026-11-04T12:00:00.000Z",
        "corr-1",
        "u1",
        "p1",
        3,
        "",
        "2026-11-04T12:00:00.000Z",
      ],
    ]);
  });

  it("rejects unmapped topics and invalid data without calling the API", async () => {
    const post = vi.fn();
    const { sink: s } = sink(200, post);
    await expect(
      s.publish({ ...event, topic: "feedback_projection.v1", data: {} }),
    ).rejects.toThrow("projection_topic_not_mapped");
    await expect(
      s.publish({ ...event, data: { ...event.data, extra: "x" } }),
    ).rejects.toBeInstanceOf(MakeProjectionPermanentFailure);
    expect(post).not.toHaveBeenCalled();
  });

  it("classifies retryable and permanent HTTP failures", async () => {
    await expect(sink(429).sink.publish(event)).rejects.toBeInstanceOf(
      MakeProjectionRetryableFailure,
    );
    await expect(sink(503).sink.publish(event)).rejects.toBeInstanceOf(
      MakeProjectionRetryableFailure,
    );
    await expect(sink(403).sink.publish(event)).rejects.toThrow("http_403");
    await expect(
      sink(200, async () => {
        throw new Error("net");
      }).sink.publish(event),
    ).rejects.toThrow("transport_failure");
  });

  it("fails closed on empty token and invalid config", async () => {
    const s = new GoogleSheetsProjectionSink({
      spreadsheetId: SPREADSHEET,
      sheetByTopic: { "package_balance_projection.v1": "Tab" },
      accessToken: () => " ",
      post: vi.fn(),
    });
    await expect(s.publish(event)).rejects.toThrow(
      "invalid_projection_authorization",
    );
    expect(
      () =>
        new GoogleSheetsProjectionSink({
          spreadsheetId: "../etc",
          sheetByTopic: {},
          accessToken: () => "t",
          post: vi.fn(),
        }),
    ).toThrow("google_sheets_projection_invalid_spreadsheet_id");
    expect(
      () =>
        new GoogleSheetsProjectionSink({
          spreadsheetId: SPREADSHEET,
          sheetByTopic: { "feedback_projection.v1": "a'!b" },
          accessToken: () => "t",
          post: vi.fn(),
        }),
    ).toThrow("google_sheets_projection_invalid_sheet_name");
  });
});
