import { expect, it, vi } from "vitest";
import { createExpertCardService } from "./expert-card-service.js";
const id = "00000000-0000-4000-8000-000000000001";
const workflow = {
  applicationId: id,
  draftId: id,
  revision: 2,
  status: "collecting" as const,
  entryCount: 2,
  materialStatus: "waiting_content" as const,
  promoConfirmed: false,
};
const input = {
  botId: "11",
  botKey: "work",
  telegramUserId: "33",
  chatId: "33",
  updateId: "10",
  requestDigest: "a".repeat(64),
  content: { kind: "text" as const, text: "private-raw-answer" },
};
function fixture(mainCheckout?: unknown) {
  const getWorkflow = vi.fn(async () => workflow as typeof workflow | null),
    addEntry = vi.fn(async () => ({ ...workflow, revision: 3, replay: false })),
    submitDraft = vi.fn(async () => ({
      ...workflow,
      status: "manager_review" as const,
      replay: false,
    })),
    submitPromoProof = vi.fn(async () => ({ ...workflow, replay: false })),
    issueWorkHandoff = vi.fn(async () => ({
      kind: "issued" as const,
      token: "x".repeat(43),
      expiresAt: "2026-10-24T00:00:00.000Z",
    })),
    redeemWorkHandoff = vi.fn(async () => ({
      kind: "linked" as const,
      applicationId: id,
      userId: id,
    }));
  const quoteMain = vi.fn(async () => ({
      id,
      priceMinor: "900000",
      termMonths: 3 as const,
      expiresAt: "2026-10-24T00:00:00.000Z",
      revision: 2,
      replay: false,
    })),
    acceptMain = vi.fn(async () => ({
      acceptanceId: id,
      quoteId: id,
      revision: 2,
      replay: false,
    })),
    createMainInvoice = vi.fn(async () => ({
      orderId: id,
      quoteId: id,
      revision: 2,
      priceMinor: "900000",
      cashMinor: "900000",
      currency: "RUB" as const,
      status: "payment_pending",
      paymentDeadline: "2026-10-24T00:00:00.000Z",
      replay: false,
    }));
  const checkoutBindingForOwner = vi.fn(async () => ({
      orderId: id,
      userId: id,
      expertId: id,
      amountMinor: "900000",
      currency: "RUB" as const,
      providerMode: "test" as const,
      purpose: "main_residency" as const,
      paymentDeadline: "2026-10-24T00:00:00.000Z",
      idempotencyKey: "canonical-order-key",
    })),
    verifyMainCheckoutForOwner = vi.fn(async () => true);
  const repository = {
      getWorkflow,
      addEntry,
      submitDraft,
      submitPromoProof,
      issueWorkHandoff,
      redeemWorkHandoff,
    },
    financial = {
      quoteMain,
      acceptMain,
      createMainInvoice,
      checkoutBindingForOwner,
      verifyMainCheckoutForOwner,
    };
  const service = createExpertCardService({
    enabled: true,
    paymentMode: "test",
    ...(mainCheckout ? { mainCheckout: mainCheckout as never } : {}),
    workBotId: "11",
    workBotKey: "work",
    workBotUsername: "synthetic_work_bot",
    promoScope: { botId: "22", botKey: "promo" },
    repository,
    financial,
  });
  return { service, ...repository, ...financial };
}
it("stores a paid owner's private raw text without echoing it", async () => {
  const f = fixture();
  const result = await f.service.handleWork(input);
  expect(result.status).toBe("handled");
  expect(f.addEntry).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 2,
      entry: { kind: "text", text: "private-raw-answer" },
      requestKey: "11:10",
    }),
  );
  expect(JSON.stringify(result)).not.toContain("private-raw-answer");
});
it.each(["photo", "document"] as const)(
  "stores only the protected opaque %s reference",
  async (kind) => {
    const f = fixture();
    await f.service.handleWork({
      ...input,
      content: { kind, reference: "telegram:file:synthetic_file" },
    });
    expect(f.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: { kind, reference: "telegram:file:synthetic_file" },
      }),
    );
  },
);
it("passes existing active expert slash commands through untouched", async () => {
  const f = fixture();
  expect(
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: "/schedule" },
    }),
  ).toEqual({ status: "unhandled" });
  expect(f.addEntry).not.toHaveBeenCalled();
});
it("does not accept raw material from an unpaid/unlinked identity", async () => {
  const f = fixture();
  f.getWorkflow.mockResolvedValueOnce(null);
  expect((await f.service.handleWork(input)).status).toBe("unhandled");
  expect(f.addEntry).not.toHaveBeenCalled();
});
it("binds draft submission to explicit current revision", async () => {
  const f = fixture();
  await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/card_submit 2" },
  });
  expect(f.submitDraft).toHaveBeenCalledWith(
    expect.objectContaining({ expectedRevision: 2, requestKey: "11:10" }),
  );
});
it("collects explicit public-promo proof separately from private card entries", async () => {
  const f = fixture();
  await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/promo_proof 2 https://example.org/post" },
  });
  expect(f.submitPromoProof).toHaveBeenCalledWith(
    expect.objectContaining({
      proof: { kind: "link", reference: "https://example.org/post" },
      expectedRevision: 2,
    }),
  );
  expect(f.addEntry).not.toHaveBeenCalled();
});
it.each([
  "http://example.org",
  "https://user:pass@example.org",
  "https://127.0.0.1/x",
  "https://localhost/x",
])("rejects unsafe proof link %s", async (url) => {
  const f = fixture();
  expect(
    (
      await f.service.handleWork({
        ...input,
        content: { kind: "text", text: `/promo_proof 2 ${url}` },
      })
    ).status,
  ).toBe("rejected");
  expect(f.submitPromoProof).not.toHaveBeenCalled();
});
it.each([1, 3] as const)(
  "requests an immutable explicit%s-month main quote",
  async (termMonths) => {
    const f = fixture();
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: `/main_tariff ${id} ${termMonths} 2` },
    });
    expect(f.quoteMain).toHaveBeenCalledWith(
      expect.objectContaining({
        tariffVersionId: id,
        termMonths,
        revision: 2,
        requestKey: "11:10",
      }),
    );
  },
);
it("requires explicit quote acceptance before asking stored authority for invoice", async () => {
  const f = fixture();
  await f.service.handleWork({
    ...input,
    content: { kind: "text", text: `/main_accept ${id} 2` },
  });
  expect(f.acceptMain).toHaveBeenCalledWith(
    expect.objectContaining({ quoteId: id, revision: 2 }),
  );
  expect(f.createMainInvoice).not.toHaveBeenCalled();
});
it("reports actual pending main invoice without fabricating payment URL", async () => {
  const f = fixture();
  const r = await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/main_invoice 2" },
  });
  expect(f.createMainInvoice).toHaveBeenCalledWith(
    expect.objectContaining({ revision: 2 }),
  );
  expect(JSON.stringify(r)).not.toContain("https://");
  expect(JSON.stringify(r)).not.toContain("оплачен");
});
it("redeems owner-bound work handoff before requiring work mapping", async () => {
  const f = fixture();
  await f.service.handleWork({
    ...input,
    content: { kind: "text", text: `/start card_${"x".repeat(43)}` },
  });
  expect(f.redeemWorkHandoff).toHaveBeenCalledWith(
    expect.objectContaining({ token: "x".repeat(43), requestKey: "11:10" }),
  );
  expect(f.getWorkflow).not.toHaveBeenCalled();
});
it("issues a private promo-owner handoff using actual configured work username", async () => {
  const f = fixture();
  const r = await f.service.handlePromoHandoff({
    ...input,
    botId: "22",
    botKey: "promo",
    updateId: 10,
    text: "/work_handoff",
  });
  expect(r.status).toBe("handled");
  expect(JSON.stringify(r)).toContain(
    `https://t.me/synthetic_work_bot?start=card_${"x".repeat(43)}`,
  );
});
it("does not issue handoff from caller supplied alternate receiving scope", async () => {
  const f = fixture();
  expect(
    (
      await f.service.handlePromoHandoff({
        ...input,
        botId: "44",
        botKey: "other",
        text: "/work_handoff",
      })
    ).status,
  ).toBe("rejected");
  expect(f.issueWorkHandoff).not.toHaveBeenCalled();
});
it("rejects invalid work scope and unsafe numeric update", async () => {
  const f = fixture();
  for (const change of [{ botId: "22" }, { chatId: "99" }, { updateId: "1.2" }])
    expect((await f.service.handleWork({ ...input, ...change })).status).toBe(
      "rejected",
    );
  expect(f.addEntry).not.toHaveBeenCalled();
});
it("returns fixed unavailable on storage errors with no PII", async () => {
  const f = fixture();
  f.addEntry.mockRejectedValueOnce(new Error("private-raw-secret"));
  expect(await f.service.handleWork(input)).toEqual({ status: "unavailable" });
});
it("preserves raw full-active expert traffic only on a DB-derived paid access fact", async () => {
  const f = fixture();
  f.getWorkflow.mockResolvedValueOnce({
    ...workflow,
    status: "approved",
    activeResident: true,
  } as never);
  expect(await f.service.handleWork(input)).toEqual({ status: "unhandled" });
  expect(f.addEntry).not.toHaveBeenCalled();
});
it("rejects malformed media caption without throwing outside the fixed boundary", async () => {
  const f = fixture();
  expect(
    await f.service.handleWork({
      ...input,
      content: {
        kind: "photo",
        reference: "telegram:file:synthetic_file",
        caption: 123,
      } as never,
    }),
  ).toEqual({ status: "rejected" });
  expect(f.addEntry).not.toHaveBeenCalled();
});
it("rejects unsafe numeric promo update before issuing a token", async () => {
  const f = fixture();
  expect(
    (
      await f.service.handlePromoHandoff({
        ...input,
        botId: "22",
        botKey: "promo",
        updateId: 9007199254740992,
        text: "/work_handoff",
      })
    ).status,
  ).toBe("rejected");
  expect(f.issueWorkHandoff).not.toHaveBeenCalled();
});
it("does not ask the financial authority to quote revision zero", async () => {
  const f = fixture();
  expect(
    (
      await f.service.handleWork({
        ...input,
        content: { kind: "text", text: `/main_tariff ${id} 1 0` },
      })
    ).status,
  ).toBe("rejected");
  expect(f.quoteMain).not.toHaveBeenCalled();
});
it("keeps private media proof separate from draft entries", async () => {
  const f = fixture();
  await f.service.handleWork({
    ...input,
    content: {
      kind: "document",
      reference: "telegram:file:synthetic_proof",
      caption: "/promo_proof 2",
    },
  });
  expect(f.submitPromoProof).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 2,
      proof: { kind: "document", reference: "telegram:file:synthetic_proof" },
    }),
  );
  expect(f.addEntry).not.toHaveBeenCalled();
});
it("keeps malformed work handoff tokens out of legacy expert command routing", async () => {
  const f = fixture();
  expect(
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: "/start card_bad" },
    }),
  ).toEqual({ status: "rejected" });
  expect(f.getWorkflow).not.toHaveBeenCalled();
});
it.each(["/unknown", "/main_invoice 2"])(
  "media caption %s cannot become financial authority or lose the raw reference",
  async (caption) => {
    const f = fixture();
    await f.service.handleWork({
      ...input,
      content: {
        kind: "photo",
        reference: "telegram:file:synthetic_file",
        caption,
      },
    });
    expect(f.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: { kind: "photo", reference: "telegram:file:synthetic_file" },
      }),
    );
    expect(f.createMainInvoice).not.toHaveBeenCalled();
  },
);

const replayCommands = [
  ["addEntry", "private-answer"],
  ["submitDraft", "/card_submit 2"],
  ["submitPromoProof", "/promo_proof 2 https://example.org/post"],
  ["quoteMain", `/main_tariff ${id} 1 2`],
  ["acceptMain", `/main_accept ${id} 2`],
  ["createMainInvoice", "/main_invoice 2"],
] as const;
it.each(replayCommands)(
  "same-event %s replay suppresses another response",
  async (method, text) => {
    const f = fixture();
    const prior = await f[method]();
    f[method].mockResolvedValueOnce({ ...prior, replay: true } as never);
    expect(
      await f.service.handleWork({ ...input, content: { kind: "text", text } }),
    ).toEqual({ status: "duplicate" });
  },
);
it("same handoff redemption replay is only acknowledged", async () => {
  const f = fixture();
  f.redeemWorkHandoff.mockResolvedValueOnce({
    kind: "duplicate",
    applicationId: id,
    userId: id,
  } as never);
  expect(
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: `/start card_${"x".repeat(43)}` },
    }),
  ).toEqual({ status: "duplicate" });
});
it("automatically returns a configured main provider link only after stored owner/order verification", async () => {
  const createOrRecover = vi.fn(async () => ({
    kind: "ready" as const,
    orderId: id,
    paymentId: "payment-synthetic",
    url: "https://yoomoney.ru/checkout/synthetic",
  }));
  const f = fixture({ strictFirstSendCancellation: true, createOrRecover });
  const r = await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/main_invoice 2" },
  });
  expect(createOrRecover).toHaveBeenCalledWith(
    expect.objectContaining({
      orderId: id,
      purpose: "main_residency",
      amountMinor: "900000",
      idempotencyKey: "canonical-order-key",
    }),
  );
  expect(f.verifyMainCheckoutForOwner).toHaveBeenCalledWith(
    expect.objectContaining({ requestKey: "11:10", revision: 2 }),
    id,
    "payment-synthetic",
    "https://yoomoney.ru/checkout/synthetic",
  );
  expect(r).toMatchObject({
    status: "handled",
    payment: {
      status: "ready",
      orderId: id,
      url: "https://yoomoney.ru/checkout/synthetic",
    },
  });
});
it.each(["pending", "unavailable"] as const)(
  "does not invent provider link after %s checkout outcome",
  async (kind) => {
    const f = fixture({
      strictFirstSendCancellation: true,
      createOrRecover: async () => ({ kind }),
    });
    const r = await f.service.handleWork({
      ...input,
      content: { kind: "text", text: "/main_invoice 2" },
    });
    expect(r).toMatchObject({ payment: { status: kind } });
    expect(JSON.stringify(r)).not.toContain("https://");
  },
);
it("does not disclose a URL whose stored operation verification fails", async () => {
  const f = fixture({
    strictFirstSendCancellation: true,
    createOrRecover: async () => ({
      kind: "ready",
      orderId: id,
      paymentId: "payment-synthetic",
      url: "https://yoomoney.ru/checkout/synthetic",
    }),
  });
  f.verifyMainCheckoutForOwner.mockResolvedValueOnce(false);
  const r = await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/main_invoice 2" },
  });
  expect(r).toMatchObject({ payment: { status: "unavailable" } });
  expect(JSON.stringify(r)).not.toContain("https://");
});
it("rejects a different order returned by checkout without disclosing the link", async () => {
  const f = fixture({
    strictFirstSendCancellation: true,
    createOrRecover: async () => ({
      kind: "ready",
      orderId: "00000000-0000-4000-8000-000000000099",
      paymentId: "payment-synthetic",
      url: "https://yoomoney.ru/checkout/synthetic",
    }),
  });
  expect(
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: "/main_invoice 2" },
    }),
  ).toMatchObject({ payment: { status: "unavailable" } });
  expect(f.verifyMainCheckoutForOwner).not.toHaveBeenCalled();
});
it("same-event invoice replay never repeats provider work", async () => {
  const createOrRecover = vi.fn(async () => ({ kind: "pending" }));
  const f = fixture({ strictFirstSendCancellation: true, createOrRecover });
  f.createMainInvoice.mockResolvedValueOnce({
    ...(await f.createMainInvoice()),
    replay: true,
  });
  expect(
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: "/main_invoice 2" },
    }),
  ).toEqual({ status: "duplicate" });
  expect(createOrRecover).not.toHaveBeenCalled();
});
it("missing main checkout remains explicitly inactive", async () => {
  const f = fixture();
  expect(
    await f.service.handleWork({
      ...input,
      content: { kind: "text", text: "/main_invoice 2" },
    }),
  ).toMatchObject({ payment: { status: "waiting_configuration" } });
});

it("shows honest awaiting-materials copy while the interview remains open", async () => {
  const f = fixture();
  const result = await f.service.handleWork({
    ...input,
    content: { kind: "text", text: "/card" },
  });
  expect(result).toMatchObject({ status: "handled" });
  if (result.status === "handled")
    expect(result.text).toContain(
      "Ваши материалы для рассылки будут доступны в ближайшее время",
    );
  expect(f.addEntry).not.toHaveBeenCalled();
});
it("accepts application promo proof through the verified promo bot before card approval", async () => {
  const f = fixture();
  const result = await f.service.handlePromoHandoff({
    botId: "22",
    botKey: "promo",
    telegramUserId: "33",
    chatId: "33",
    updateId: 19,
    text: "/promo_proof 0 https://example.com/announcement",
  });
  expect(result.status).toBe("handled");
  expect(f.submitPromoProof).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 0,
      proof: { kind: "link", reference: "https://example.com/announcement" },
    }),
  );
});
