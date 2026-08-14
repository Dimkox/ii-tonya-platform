import { describe, expect, it, vi } from "vitest";

import {
  CLIENT_CATALOG_OUTBOX_TOPICS,
  createClientCatalogOutboxRegistry,
  createClientCatalogSourceReader,
} from "./client-catalog-outbox.js";
import { selectWorkerOutboxRegistry } from "./main.js";

const catalogRequestId = "00000000-0000-4000-8000-000000000201";
const outboxId = "00000000-0000-4000-8000-000000000301";
const message = (payload: unknown, topic = "catalog.show") => ({
  id: outboxId,
  topic,
  payload,
  correlationId: "private-correlation",
  attempt: 1,
  reconciliationKey: "private-reconciliation",
  reconciliationAttempt: 0,
  dispatchClaimToken: "claim",
  reconciliationClaimToken: null,
});

const build = () => {
  const localDispatch = vi.fn(async () => ({ kind: "applied" as const }));
  const localReconcile = vi.fn(async () => ({ kind: "applied" as const }));
  const loadPending = vi.fn(async () => ({
    catalogRequestId,
    serviceCode: "career",
    language: "ru",
    databaseNow: new Date("2026-08-14T10:00:00.000Z"),
  }));
  const materialize = vi.fn(async () => "ready" as const);
  const list = vi.fn(async () => []);
  const registry = createClientCatalogOutboxRegistry({
    local: {
      topics: [
        "safety.operator_escalation",
        "admin.negative_feedback",
      ] as const,
      dispatch: localDispatch,
      reconcile: localReconcile,
    },
    requests: { loadPending, materialize },
    source: { list },
  });
  return {
    registry,
    localDispatch,
    localReconcile,
    loadPending,
    materialize,
    list,
  };
};

describe("client catalog catalog.show registry", () => {
  it("preserves the exact local tuple and appends catalog.show only in the composite", () => {
    expect(CLIENT_CATALOG_OUTBOX_TOPICS).toEqual([
      "safety.operator_escalation",
      "admin.negative_feedback",
      "catalog.show",
    ]);
    expect(build().registry.topics).toBe(CLIENT_CATALOG_OUTBOX_TOPICS);
  });

  it("strictly recognizes the request-origin payload and materializes once", async () => {
    const state = build();

    await expect(
      state.registry.dispatch(message({ v: 1, catalogRequestId })),
    ).resolves.toEqual({ kind: "applied" });
    expect(state.loadPending).toHaveBeenCalledWith(catalogRequestId);
    expect(state.list).toHaveBeenCalledWith({
      serviceCode: "career",
      language: "ru",
      databaseNow: new Date("2026-08-14T10:00:00.000Z"),
    });
    expect(state.materialize).toHaveBeenCalledWith({
      catalogRequestId,
      cards: [],
    });
  });

  it("accepts the unchanged conversation-origin payload as a separate no-mutation branch", async () => {
    const state = build();
    const legacy = {
      serviceCode: "career",
      allowedServiceCodes: ["career"],
    };

    await expect(state.registry.dispatch(message(legacy))).resolves.toEqual({
      kind: "applied",
    });
    expect(legacy).toEqual({
      serviceCode: "career",
      allowedServiceCodes: ["career"],
    });
    expect(state.loadPending).not.toHaveBeenCalled();
    expect(state.materialize).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { v: 1, catalogRequestId, serviceCode: "mixed" },
    { v: 2, catalogRequestId },
    { catalogRequestId },
    { serviceCode: "career", allowedServiceCodes: ["career"], extra: true },
  ])("terminalizes an unknown or mixed payload without guessing: %j", async (payload) => {
    const state = build();
    await expect(state.registry.dispatch(message(payload))).resolves.toEqual({
      kind: "terminal",
      reasonCode: "invalid_payload",
    });
    expect(state.loadPending).not.toHaveBeenCalled();
  });

  it("delegates only the original two local topics to the prerequisite registry", async () => {
    const state = build();
    await state.registry.dispatch(
      message(
        { handoffId: catalogRequestId, version: 1, charge: 0 },
        "safety.operator_escalation",
      ),
    );
    expect(state.localDispatch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { worker: false, catalog: false, extended: false },
    { worker: true, catalog: false, extended: false },
    { worker: false, catalog: true, extended: false },
    { worker: true, catalog: true, extended: true },
  ])(
    "composes the extended tuple only for worker=$worker catalog=$catalog",
    ({ worker, catalog, extended }) => {
      const local = {
        topics: [
          "safety.operator_escalation",
          "admin.negative_feedback",
        ] as const,
        dispatch: async () => ({ kind: "applied" as const }),
        reconcile: async () => ({ kind: "applied" as const }),
      };
      const composite = build().registry;
      const selected = selectWorkerOutboxRegistry(
        {
          features: {
            workerOutboxDelivery: worker,
            clientCatalog: catalog,
          },
        } as never,
        () => (extended ? composite : local),
      );
      if (!worker) expect(selected).toBeUndefined();
      else expect(selected?.topics).toHaveLength(extended ? 3 : 2);
    },
  );

  it("fails closed when both flags are enabled without the composite registry", () => {
    const local = {
      topics: [
        "safety.operator_escalation",
        "admin.negative_feedback",
      ] as const,
      dispatch: async () => ({ kind: "applied" as const }),
      reconcile: async () => ({ kind: "applied" as const }),
    };
    expect(() =>
      selectWorkerOutboxRegistry(
        {
          features: {
            workerOutboxDelivery: true,
            clientCatalog: true,
          },
        } as never,
        () => local,
      ),
    ).toThrow("worker_outbox_delivery_capability_unavailable");
  });
});

describe("bounded client catalog source reader", () => {
  it("returns catalog-only cards without an approved availability capability", async () => {
    const listPublicServices = vi.fn(async () => [
      {
        sourceKey: "private-service-id",
        displayName: "Expert",
        serviceCode: "career",
        language: "ru",
      },
    ]);
    const reader = createClientCatalogSourceReader({ listPublicServices });

    await expect(
      reader.list({ databaseNow: new Date("2026-08-14T10:00:00.000Z") }),
    ).resolves.toEqual([
      {
        displayName: "Expert",
        serviceCode: "career",
        language: "ru",
        availability: "catalog_only",
        slots: [],
      },
    ]);
  });

  it("uses only complete fresh positive availability and caps deterministic slots at three", async () => {
    const listPublicServices = vi.fn(async () => [
      {
        sourceKey: "private-service-id",
        displayName: "Expert",
        serviceCode: "career",
        language: "ru",
      },
    ]);
    const read = vi.fn(async () => ({
      kind: "complete" as const,
      slots: [
        {
          sourceOrder: "4",
          startsAt: new Date("2026-08-16T14:00:00.000Z"),
          observedAt: new Date("2026-08-14T09:50:00.000Z"),
          remainingCapacity: 1,
        },
        {
          sourceOrder: "2",
          startsAt: new Date("2026-08-16T12:00:00.000Z"),
          observedAt: new Date("2026-08-14T09:50:00.000Z"),
          remainingCapacity: 2,
        },
        {
          sourceOrder: "1",
          startsAt: new Date("2026-08-16T11:00:00.000Z"),
          observedAt: new Date("2026-08-14T09:50:00.000Z"),
          remainingCapacity: 1,
        },
        {
          sourceOrder: "3",
          startsAt: new Date("2026-08-16T13:00:00.000Z"),
          observedAt: new Date("2026-08-14T09:50:00.000Z"),
          remainingCapacity: 1,
        },
      ],
    }));
    const reader = createClientCatalogSourceReader(
      { listPublicServices },
      { read },
    );

    await expect(
      reader.list({ databaseNow: new Date("2026-08-14T10:00:00.000Z") }),
    ).resolves.toEqual([
      expect.objectContaining({
        availability: "fresh_slots",
        slots: [
          { startsAt: "2026-08-16T11:00:00.000Z" },
          { startsAt: "2026-08-16T12:00:00.000Z" },
          { startsAt: "2026-08-16T13:00:00.000Z" },
        ],
      }),
    ]);
  });

  it.each([
    {
      name: "stale",
      observedAt: new Date("2026-08-14T09:44:59.999Z"),
      startsAt: new Date("2026-08-16T10:00:00.000Z"),
      remainingCapacity: 1,
    },
    {
      name: "future-observed",
      observedAt: new Date("2026-08-14T10:00:00.001Z"),
      startsAt: new Date("2026-08-16T10:00:00.000Z"),
      remainingCapacity: 1,
    },
    {
      name: "too-soon",
      observedAt: new Date("2026-08-14T10:00:00.000Z"),
      startsAt: new Date("2026-08-15T09:59:59.999Z"),
      remainingCapacity: 1,
    },
    {
      name: "unknown-capacity",
      observedAt: new Date("2026-08-14T10:00:00.000Z"),
      startsAt: new Date("2026-08-16T10:00:00.000Z"),
      remainingCapacity: null,
    },
  ])("degrades the entire $name result to catalog-only", async (slot) => {
    const reader = createClientCatalogSourceReader(
      {
        listPublicServices: async () => [
          {
            sourceKey: "private-service-id",
            displayName: "Expert",
            serviceCode: "career",
            language: "ru",
          },
        ],
      },
      {
        read: async () => ({
          kind: "complete",
          slots: [{ ...slot, sourceOrder: "private-slot-id" }],
        }),
      },
    );
    await expect(
      reader.list({ databaseNow: new Date("2026-08-14T10:00:00.000Z") }),
    ).resolves.toEqual([
      expect.objectContaining({ availability: "catalog_only", slots: [] }),
    ]);
  });
});
