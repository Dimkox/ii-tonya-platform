import { describe, expect, it } from "vitest";
import { parsePlanerkaServiceMappingFile } from "./planerka-service-mapping-admin.js";

const SERVICE = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const valid = {
  accountId: 7,
  mappings: [{ expertServiceId: SERVICE, eventTypeId: 11, timeZone: "UTC" }],
};

describe("parsePlanerkaServiceMappingFile (SCRUM-519)", () => {
  it("accepts a valid file and defaults enabled=true", () => {
    expect(parsePlanerkaServiceMappingFile(valid, 7)).toEqual({
      accountId: 7,
      mappings: [
        {
          expertServiceId: SERVICE,
          eventTypeId: 11,
          timeZone: "UTC",
          enabled: true,
        },
      ],
    });
  });

  it.each([
    [null, "root"],
    [{ ...valid, extra: 1 }, "unknown_field"],
    [{ ...valid, accountId: 0 }, "account_id"],
    [{ ...valid, mappings: [] }, "mappings"],
    [
      { ...valid, mappings: [{ ...valid.mappings[0], expertServiceId: "x" }] },
      "mapping_0_expert_service_id",
    ],
    [
      { ...valid, mappings: [{ ...valid.mappings[0], eventTypeId: 1.5 }] },
      "mapping_0_event_type_id",
    ],
    [
      { ...valid, mappings: [{ ...valid.mappings[0], timeZone: "Mars/Base" }] },
      "mapping_0_time_zone",
    ],
    [
      { ...valid, mappings: [{ ...valid.mappings[0], enabled: "yes" }] },
      "mapping_0_enabled",
    ],
    [
      { ...valid, mappings: [{ ...valid.mappings[0], note: "x" }] },
      "mapping_0_unknown_field",
    ],
    [
      { ...valid, mappings: [valid.mappings[0], valid.mappings[0]] },
      "mapping_1_duplicate_service",
    ],
    [
      {
        ...valid,
        mappings: [
          valid.mappings[0],
          { ...valid.mappings[0], expertServiceId: OTHER },
        ],
      },
      "mapping_1_duplicate_event_type",
    ],
  ])("rejects %j (%s)", (raw, reason) => {
    expect(() => parsePlanerkaServiceMappingFile(raw)).toThrow(
      `planerka_mapping_file_invalid:${reason}`,
    );
  });

  it("rejects a file for another Planerka account", () => {
    expect(() => parsePlanerkaServiceMappingFile(valid, 8)).toThrow(
      "planerka_mapping_file_invalid:account_mismatch",
    );
  });
});
