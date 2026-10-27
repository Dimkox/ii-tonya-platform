import { describe, expect, it } from "vitest";
import {
  generateSchedule,
  importSchedule,
  scheduleRulesSchema,
  resolveScheduleTime,
  scheduleTimezones,
} from "./resident-schedule.js";

const services = [
  { id: "one", title: "Консультация", durationMinutes: 60 },
  { id: "two", title: "Разбор", durationMinutes: 90 },
];
const rules = {
  timezone: "Europe/Moscow",
  from: "2026-11-02",
  to: "2026-11-02",
  weekdays: [0],
  start: "09:00",
  end: "14:00",
  breaks: [{ start: "11:30", end: "12:00" }],
  bufferMinutes: 15,
};
describe("resident schedule", () => {
  it("generates each service independently with buffer and break containment", () => {
    const result = generateSchedule(rules, services);
    expect(result.errors).toEqual([]);
    expect(
      result.slots
        .filter((x) => x.serviceId === "one")
        .map((x) => x.localStart),
    ).toEqual(["2026-11-02T09:00", "2026-11-02T10:15", "2026-11-02T12:00"]);
    expect(
      result.slots
        .filter((x) => x.serviceId === "two")
        .map((x) => x.localStart),
    ).toEqual(["2026-11-02T09:00", "2026-11-02T12:00"]);
    expect(result.slots[0]).toMatchObject({
      startsAt: "2026-11-02T06:00:00.000Z",
      endsAt: "2026-11-02T07:00:00.000Z",
      occupiedUntil: "2026-11-02T07:15:00.000Z",
    });
  });
  it.each(["2026-02-30", "2026-13-01"])(
    "rejects impossible calendar date %s",
    (from) => {
      expect(() => scheduleRulesSchema.parse({ ...rules, from })).toThrow();
    },
  );
  it.each([
    { timezone: "Not/AZone" },
    { bufferMinutes: -1 },
    { from: "2026-01-01" },
    {
      breaks: [
        { start: "10:00", end: "12:00" },
        { start: "11:00", end: "13:00" },
      ],
    },
  ])("rejects invalid and unbounded rules %j", (patch) => {
    expect(() => scheduleRulesSchema.parse({ ...rules, ...patch })).toThrow();
  });
  it("rejects missing and repeated times unless an explicit valid offset resolves repetition", () => {
    expect(() =>
      resolveScheduleTime("2027-03-28T02:30", "Europe/Berlin"),
    ).toThrow();
    expect(() =>
      resolveScheduleTime("2026-10-25T02:30", "Europe/Berlin"),
    ).toThrow();
    expect(
      resolveScheduleTime("2026-10-25T02:30", "Europe/Berlin", "+01:00"),
    ).toBe("2026-10-25T01:30:00.000Z");
    expect(() =>
      resolveScheduleTime("2026-10-25T02:30", "Europe/Berlin", "+03:00"),
    ).toThrow();
  });
  it("does not emit intervals spanning a DST change with wrong elapsed duration", () => {
    const result = generateSchedule(
      {
        ...rules,
        timezone: "Europe/Berlin",
        from: "2027-03-28",
        to: "2027-03-28",
        weekdays: [6],
        start: "01:00",
        end: "05:00",
        breaks: [],
        bufferMinutes: 0,
      },
      [{ id: "one", title: "Разбор", durationMinutes: 180 }],
    );
    expect(result.slots).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
  it("imports text and quoted CSV and treats formula-like names only as data", () => {
    const result = importSchedule(
      '2026-11-02 09:00-10:00 Консультация\n2026-11-02,12:00,13:30,"Разбор"',
      rules,
      services,
    );
    expect(result.errors).toEqual([]);
    expect(result.slots).toHaveLength(2);
    const formula = importSchedule("2026-11-02 09:00-10:00 =SUM(A1)", rules, [
      { ...services[0]!, title: "=SUM(A1)" },
    ]);
    expect(formula.slots).toHaveLength(1);
  });
  it("reports row errors and never returns partially committable import", () => {
    const result = importSchedule(
      "2026-11-02 09:00-10:00 Консультация\n2026-11-02 09:00-10:00 Консультация\n2026-02-30 09:00-10:00 Неизвестно\n2026-11-02 12:00-12:30 Разбор",
      rules,
      services,
    );
    expect(result.errors.map((x) => x.row)).toEqual([2, 3, 4]);
    expect(result.committable).toBe(false);
  });
  it("requires owner-scoped stable ID for duplicate titles and denies foreign IDs", () => {
    const owned = services.map((s) => ({ ...s, title: "Встреча" }));
    expect(
      importSchedule("2026-11-02 09:00-10:00 Встреча", rules, owned)
        .committable,
    ).toBe(false);
    expect(
      importSchedule("2026-11-02 09:00-10:00 id:one", rules, owned).committable,
    ).toBe(true);
    expect(
      importSchedule("2026-11-02 09:00-10:00 id:foreign", rules, owned)
        .committable,
    ).toBe(false);
  });
  it("caps output and validates typed durations before iterating", () => {
    expect(() =>
      generateSchedule(rules, [{ ...services[0]!, durationMinutes: 0 }]),
    ).toThrow();
    const result = generateSchedule(
      {
        ...rules,
        from: "2026-11-01",
        to: "2026-11-30",
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        start: "00:00",
        end: "23:59",
        breaks: [],
        bufferMinutes: 0,
      },
      [{ ...services[0]!, durationMinutes: 5 }],
    );
    expect(result.slots.length).toBeLessThanOrEqual(500);
    expect(result.committable).toBe(false);
  });
  it("offers readable explicit timezone choices", () => {
    expect(
      scheduleTimezones.some(
        (x) =>
          x.zone === "Europe/Moscow" &&
          x.label.includes("Москва") &&
          x.label.includes("UTC+03:00"),
      ),
    ).toBe(true);
  });
});

it("imports a repeated-hour interval only when both endpoints use the explicit offset", () => {
  const repeated = {
    ...rules,
    timezone: "Europe/Berlin",
    from: "2026-10-25",
    to: "2026-10-25",
    weekdays: [6],
    start: "02:00",
    end: "03:30",
    breaks: [],
    bufferMinutes: 0,
  };
  const resolved = importSchedule(
    "2026-10-25,02:10,02:40,Разбор,+01:00",
    repeated,
    [{ id: "one", title: "Разбор", durationMinutes: 30 }],
  );
  expect(resolved.errors).toEqual([]);
  expect(resolved.slots[0]).toMatchObject({
    startsAt: "2026-10-25T01:10:00.000Z",
    endsAt: "2026-10-25T01:40:00.000Z",
  });
});
