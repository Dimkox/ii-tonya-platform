import {
  isRetryableStatus,
  MakeProjectionPermanentFailure,
  MakeProjectionRetryableFailure,
  responseStatus,
  topicDataTypes,
  validatedEvent,
} from "./make-projection-sink.js";
import type {
  ProjectionEvent,
  ProjectionSink,
  ProjectionTopic,
} from "./projection-port.js";

/**
 * Append-only Google Sheets projection (SCRUM-507).
 * One row per event: eventId, topic, occurredAt, correlationId, then the
 * topic's fields in a fixed column order (missing optional fields => "").
 * Sheets is a reporting copy only; the DB stays the source of truth.
 */
export type GoogleSheetsCell = string | number | boolean;

export interface GoogleSheetsAppendRequest {
  endpoint: URL;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: { values: GoogleSheetsCell[][] };
  signal: AbortSignal;
}

export interface GoogleSheetsProjectionSinkDeps {
  spreadsheetId: string;
  /** Sheet (tab) name per topic; a topic without a tab is rejected. */
  sheetByTopic: Readonly<Partial<Record<ProjectionTopic, string>>>;
  accessToken: () => string;
  post: (request: GoogleSheetsAppendRequest) => Promise<{ status: number }>;
}

export const googleSheetsProjectionColumns = (
  topic: ProjectionTopic,
): readonly string[] => [
  "eventId",
  "topic",
  "occurredAt",
  "correlationId",
  ...Object.keys(topicDataTypes[topic]),
];

export const googleSheetsProjectionRow = (
  event: ProjectionEvent,
): GoogleSheetsCell[] => {
  const projection = validatedEvent(event);
  const cell = (value: string | number | boolean | null | undefined) =>
    value ?? "";
  return [
    projection.eventId,
    projection.topic,
    projection.occurredAt,
    projection.correlationId,
    ...Object.keys(topicDataTypes[projection.topic]).map((field) =>
      cell(projection.data[field]),
    ),
  ];
};

const spreadsheetIdPattern = /^[A-Za-z0-9_-]{20,128}$/;
const sheetNamePattern = /^[\p{L}\p{N} _-]{1,64}$/u;

export class GoogleSheetsProjectionSink implements ProjectionSink {
  constructor(private readonly deps: GoogleSheetsProjectionSinkDeps) {
    if (!spreadsheetIdPattern.test(deps.spreadsheetId)) {
      throw new Error("google_sheets_projection_invalid_spreadsheet_id");
    }
    for (const name of Object.values(deps.sheetByTopic)) {
      if (typeof name !== "string" || !sheetNamePattern.test(name)) {
        throw new Error("google_sheets_projection_invalid_sheet_name");
      }
    }
  }

  async publish(event: ProjectionEvent): Promise<void> {
    const row = googleSheetsProjectionRow(event);
    const sheet = this.deps.sheetByTopic[event.topic];
    if (!sheet) {
      throw new MakeProjectionPermanentFailure("projection_topic_not_mapped");
    }
    let token: unknown;
    try {
      token = this.deps.accessToken();
    } catch {
      throw new MakeProjectionPermanentFailure(
        "invalid_projection_authorization",
      );
    }
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new MakeProjectionPermanentFailure(
        "invalid_projection_authorization",
      );
    }
    const endpoint = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.deps.spreadsheetId}/values/${encodeURIComponent(`'${sheet}'!A1`)}:append`,
    );
    endpoint.searchParams.set("valueInputOption", "RAW");
    endpoint.searchParams.set("insertDataOption", "INSERT_ROWS");

    let response: unknown;
    try {
      response = await this.deps.post({
        endpoint,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: { values: [row] },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new MakeProjectionRetryableFailure("transport_failure");
    }
    const status = responseStatus(response);
    if (status === undefined) {
      throw new MakeProjectionPermanentFailure("invalid_transport_response");
    }
    if (status >= 200 && status <= 299) return;
    if (isRetryableStatus(status)) {
      throw new MakeProjectionRetryableFailure(`http_${status}`);
    }
    throw new MakeProjectionPermanentFailure(`http_${status}`);
  }
}
