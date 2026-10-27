import { describe, expect, it } from "vitest";
import { renderCatalogPage } from "./catalog-view.js";
import { renderAccountPage } from "./consent-view.js";
import {
  initialDemoState,
  transitionDemo,
  exportDemoState,
  renderDemoWalkthrough,
  type DemoState,
} from "./demo-walkthrough.js";

function selected(): DemoState {
  return transitionDemo(
    transitionDemo(initialDemoState(), { type: "service", value: "demo-2" }),
    { type: "time", value: "example-evening" },
  );
}

describe("isolated customer demonstration", () => {
  it("explains retained downloads in both disclosure and synthetic export", () => {
    const page = renderDemoWalkthrough();
    const exported = JSON.parse(exportDemoState(initialDemoState()));
    expect(page).toContain(
      "Скачанный файл остаётся на устройстве после очистки, перезапуска и перезагрузки демо",
    );
    expect(exported.notice).toContain(
      "Скачанный файл остаётся на устройстве после очистки, перезапуска и перезагрузки демо",
    );
    expect(exported).toMatchObject({
      synthetic: true,
      booking: null,
      consent: "not-granted",
    });
  });

  it("warns that restarting after cancellation also resets illustrative consent", () => {
    const granted = transitionDemo(
      transitionDemo(selected(), { type: "reserve" }),
      { type: "consent", granted: true },
    );
    const cancelled = transitionDemo(granted, { type: "cancel" });
    expect(cancelled.consent).toBe("demo-granted");
    expect(cancelled.notice).toContain(
      "Полный перезапуск также сбросит демо-согласие",
    );
    expect(transitionDemo(cancelled, { type: "reset" }).consent).toBe(
      "not-granted",
    );
  });

  it("distinguishes simplified illustrative consent from separate real account purposes", () => {
    const page = renderDemoWalkthrough();
    expect(page).toContain("упрощённая иллюстрация");
    expect(page).toContain(
      "В реальном аккаунте каждая цель согласия управляется отдельно",
    );
  });

  it("starts empty, with explicit selection and ungranted consent", () => {
    expect(initialDemoState()).toMatchObject({
      service: "",
      time: "",
      booking: null,
      consent: "not-granted",
    });
  });

  it("rejects unknown or incomplete choices without reflecting arbitrary input", () => {
    for (const action of [
      { type: "service", value: "<script>invalid</script>" },
      { type: "time", value: "actual-slot" },
    ] as const) {
      const state = transitionDemo(initialDemoState(), action);
      expect(state).toMatchObject({ service: "", time: "", booking: null });
      expect(JSON.stringify(state)).not.toContain(action.value);
      expect(transitionDemo(state, { type: "reserve" }).booking).toBeNull();
    }
    const incomplete = transitionDemo(initialDemoState(), {
      type: "service",
      value: "demo-1",
    });
    expect(transitionDemo(incomplete, { type: "reserve" }).booking).toBeNull();
  });

  it("reserves exactly one unpriced booking with the selected fictional labels", () => {
    const reserved = transitionDemo(selected(), { type: "reserve" });
    expect(reserved.booking).toEqual({
      service: "Коучинг целей",
      time: "Пример дня · 18:00",
      status: "reserved",
    });
    expect(transitionDemo(reserved, { type: "reserve" })).toEqual(reserved);
    expect(
      transitionDemo(reserved, { type: "service", value: "demo-1" }),
    ).toEqual(reserved);
    expect(
      transitionDemo(reserved, { type: "time", value: "example-morning" }),
    ).toEqual(reserved);
  });

  it("accepts all six fictional services and only the fixed example times", () => {
    const labels = [
      "Карьерная консультация",
      "Коучинг целей",
      "Знакомство с йогой",
      "Практика внимания",
      "Творческая мастерская",
      "Навыки общения",
    ];
    for (const [index, label] of labels.entries()) {
      for (const [value, time] of [
        ["example-morning", "Пример дня · 10:00"],
        ["example-evening", "Пример дня · 18:00"],
      ]) {
        let state = transitionDemo(initialDemoState(), {
          type: "service",
          value: `demo-${index + 1}`,
        });
        state = transitionDemo(state, { type: "time", value: value! });
        expect(transitionDemo(state, { type: "reserve" }).booking).toEqual({
          service: label,
          time,
          status: "reserved",
        });
      }
    }
  });

  it("simulates payment only once and only for a reserved booking", () => {
    expect(transitionDemo(selected(), { type: "pay" }).booking).toBeNull();
    const paid = transitionDemo(
      transitionDemo(selected(), { type: "reserve" }),
      { type: "pay" },
    );
    expect(paid.booking?.status).toBe("simulated-paid");
    expect(transitionDemo(paid, { type: "pay" })).toEqual(paid);
    expect(paid.notice).toContain("Демо");
    expect(paid.notice).toContain("не списаны");
  });

  it.each([false, true])(
    "cancels idempotently without refund claims (paid=%s)",
    (pay) => {
      expect(
        transitionDemo(initialDemoState(), { type: "cancel" }).booking,
      ).toBeNull();
      let state = transitionDemo(selected(), { type: "reserve" });
      if (pay) state = transitionDemo(state, { type: "pay" });
      const cancelled = transitionDemo(state, { type: "cancel" });
      expect(cancelled.booking?.status).toBe("cancelled");
      expect(cancelled.notice).toContain("Демо");
      expect(cancelled.notice).toContain("не выполнялся");
      expect(transitionDemo(cancelled, { type: "cancel" })).toEqual(cancelled);
      expect(transitionDemo(cancelled, { type: "reserve" })).toEqual(cancelled);
      expect(transitionDemo(cancelled, { type: "pay" })).toEqual(cancelled);
    },
  );

  it("grants and withdraws illustrative consent independently of booking", () => {
    let state = transitionDemo(initialDemoState(), {
      type: "consent",
      granted: true,
    });
    expect(state.consent).toBe("demo-granted");
    state = transitionDemo(state, { type: "consent", granted: false });
    expect(state.consent).toBe("demo-withdrawn");
    expect(state.booking).toBeNull();
    expect(state.notice).toContain("Реальное согласие не изменено");
  });

  it.each(["clear", "reset"] as const)(
    "%s resets booking, consent and choices repeatably",
    (type) => {
      const state = transitionDemo(
        transitionDemo(selected(), { type: "reserve" }),
        { type: "consent", granted: true },
      );
      expect(state.booking?.status).toBe("reserved");
      expect(state.consent).toBe("demo-granted");
      const cleared = transitionDemo(state, { type });
      expect(cleared).toMatchObject({
        service: "",
        time: "",
        booking: null,
        consent: "not-granted",
      });
      expect(cleared.notice).toContain("Демо");
      expect(transitionDemo(cleared, { type })).toEqual(cleared);
      expect(transitionDemo(cleared, { type: "pay" }).booking).toBeNull();
      expect(initialDemoState().booking).toBeNull();
    },
  );

  it("exports an explicit synthetic projection without identity, money or real consent", () => {
    const state = transitionDemo(
      transitionDemo(selected(), { type: "reserve" }),
      { type: "pay" },
    );
    const exported = JSON.parse(exportDemoState(state));
    expect(exported).toEqual({
      kind: "ii-tonya-synthetic-demo",
      synthetic: true,
      notice: expect.stringContaining("Демо"),
      selection: { service: "Коучинг целей", time: "Пример дня · 18:00" },
      booking: {
        service: "Коучинг целей",
        time: "Пример дня · 18:00",
        status: "simulated-paid",
      },
      consent: "not-granted",
    });
    expect(JSON.parse(exportDemoState(initialDemoState()))).toMatchObject({
      booking: null,
      selection: { service: null, time: null },
    });
  });

  it("offers a demo link from catalogue and account before their live controls", () => {
    for (const markup of [renderCatalogPage(), renderAccountPage()]) {
      expect(markup).toContain('href="/demo" data-demo-link');
    }
    const catalog = renderCatalogPage();
    expect(catalog.indexOf("data-demo-link")).toBeLessThan(
      catalog.indexOf("data-demo-catalog"),
    );
  });
});
