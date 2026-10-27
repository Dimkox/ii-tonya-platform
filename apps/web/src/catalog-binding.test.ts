import { afterEach, expect, it, vi } from "vitest";
import { bindCatalogActions } from "./catalog-view.js";
import type { PublicCatalogItem } from "./catalog-client.js";

// Only the DOM surface used by the binding; real HTML parsing/security and
// browser focus behavior are independently exercised by the maintained harness.
class ElementDouble {
  textContent = "";
  innerHTML = "";
  value = "";
  disabled = false;
  hidden = false;
  children: ElementDouble[] = [];
  attributes = new Map<string, string>();
  onclick: (() => void) | null = null;
  onchange: (() => void) | null = null;
  constructor(private readonly doc: { activeElement: ElementDouble | null }) {}
  replaceChildren() {
    this.children = [];
    this.innerHTML = "";
    this.textContent = "";
  }
  append(child: ElementDouble) {
    this.children.push(child);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  focus() {
    this.doc.activeElement = this;
  }
  click() {
    if (!this.disabled) {
      this.focus();
      this.onclick?.();
    }
  }
  change(value: string) {
    this.value = value;
    this.onchange?.();
  }
}
const items: PublicCatalogItem[] = [
  { displayName: "Alpha", serviceCode: "career", language: "ru" },
  { displayName: "Beta", serviceCode: "career", language: "en" },
  { displayName: "Gamma", serviceCode: "coaching", language: "en" },
];
function setup(list = vi.fn(async () => items)) {
  const doc = {
    activeElement: null as ElementDouble | null,
    createElement: () => new ElementDouble(doc),
  };
  const selectors = [
    "[data-catalog-status]",
    "[data-catalog-results]",
    "[data-catalog-filters]",
    "#catalog-service",
    "#catalog-language",
    "[data-catalog-retry]",
    "[data-catalog-clear]",
  ];
  const nodes = new Map(
    selectors.map((selector) => [selector, new ElementDouble(doc)]),
  );
  const root = {
    querySelector: (selector: string) => nodes.get(selector) ?? null,
  };
  vi.stubGlobal("document", doc);
  bindCatalogActions(root as unknown as ParentNode, { list });
  return {
    list,
    doc,
    status: nodes.get("[data-catalog-status]")!,
    results: nodes.get("[data-catalog-results]")!,
    controls: nodes.get("[data-catalog-filters]")!,
    service: nodes.get("#catalog-service")!,
    language: nodes.get("#catalog-language")!,
    retry: nodes.get("[data-catalog-retry]")!,
    clear: nodes.get("[data-catalog-clear]")!,
  };
}
afterEach(() => vi.unstubAllGlobals());
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

it("wires initial load, populated selects, local change/reset and loaded-subset counts", async () => {
  const ui = setup();
  expect(ui.status.textContent).toBe("Загружаем каталог…");
  expect(ui.results.attributes.get("aria-busy")).toBe("true");
  await flush();
  expect(ui.service.children.map((option) => option.value)).toEqual([
    "",
    "career",
    "coaching",
  ]);
  expect(ui.language.children.map((option) => option.value)).toEqual([
    "",
    "ru",
    "en",
  ]);
  ui.service.change("career");
  ui.language.change("en");
  expect(ui.results.innerHTML).toContain("Beta");
  expect(ui.results.innerHTML).not.toMatch(/Alpha|Gamma/u);
  expect(ui.status.textContent).toBe("Показано из загруженных услуг: 1 из 3.");
  ui.service.change("coaching");
  ui.language.change("ru");
  expect(ui.results.innerHTML).toContain(
    "Среди загруженных услуг нет совпадений",
  );
  ui.clear.click();
  expect(ui.results.innerHTML.match(/data-catalog-item/gu)).toHaveLength(3);
  expect(ui.doc.activeElement).toBe(ui.service);
  expect(ui.list).toHaveBeenCalledTimes(1);
});
it.each([false, true])(
  "retry restores only its current focus ownership, moved focus=%s",
  async (moveFocus) => {
    const pending = Promise.withResolvers<PublicCatalogItem[]>();
    const list = vi
      .fn<() => Promise<PublicCatalogItem[]>>()
      .mockRejectedValueOnce(new Error("private"))
      .mockImplementationOnce(() => pending.promise);
    const ui = setup(list);
    await flush();
    expect(ui.retry.hidden).toBe(false);
    expect(ui.results.innerHTML).toBe("");
    ui.retry.click();
    expect(ui.retry.disabled).toBe(true);
    ui.retry.click();
    expect(list).toHaveBeenCalledTimes(2);
    const other = new ElementDouble(ui.doc);
    if (moveFocus) other.focus();
    pending.resolve(items);
    await flush();
    expect(ui.results.innerHTML).toContain("Alpha");
    expect(ui.doc.activeElement).toBe(moveFocus ? other : ui.status);
    expect(ui.retry.hidden).toBe(true);
  },
);
it("keeps honest empty separate from a failed retry and permits another retry", async () => {
  const list = vi
    .fn<() => Promise<PublicCatalogItem[]>>()
    .mockRejectedValueOnce(new Error("private"))
    .mockRejectedValueOnce(new Error("private again"))
    .mockResolvedValueOnce([]);
  const ui = setup(list);
  await flush();
  ui.retry.click();
  await flush();
  expect(ui.status.textContent).toBe(
    "Не удалось загрузить каталог. Попробуй ещё раз.",
  );
  expect(ui.results.innerHTML).toBe("");
  ui.retry.click();
  await flush();
  expect(ui.results.innerHTML).toContain(
    "В каталоге пока нет опубликованных услуг.",
  );
  expect(ui.controls.hidden).toBe(true);
  expect(list).toHaveBeenCalledTimes(3);
});
