import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const views = vi.hoisted(() => ({
  catalog: vi.fn(() => "<main>catalog</main>"),
  privacy: vi.fn(() => "<main>consent</main>"),
  data: vi.fn(() => "<main>my-data</main>"),
  account: vi.fn(() => "<main>account</main>"),
  bindCatalog: vi.fn(),
  bindPrivacy: vi.fn(),
  landing: vi.fn(() => "<main>landing</main>"),
}));
vi.mock("./catalog-view.js", () => ({
  renderCatalogPage: views.catalog,
  bindCatalogActions: views.bindCatalog,
}));
vi.mock("./consent-view.js", () => ({
  renderConsentPage: views.privacy,
  renderMyDataPage: views.data,
  renderAccountPage: views.account,
  bindPrivacyActions: views.bindPrivacy,
}));
vi.mock("./landing-view.js", () => ({ renderLanding: views.landing }));

const prerenderedLanding = "<main>server-rendered landing</main>";
let root: { innerHTML: string; dataset: { prerendered: string } };
let page: {
  title: string;
  querySelector: ReturnType<typeof vi.fn>;
  querySelectorAll: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  root = { innerHTML: prerenderedLanding, dataset: { prerendered: "true" } };
  page = {
    title: "landing title",
    querySelector: vi.fn((selector: string) =>
      selector === "#app" ? root : null,
    ),
    querySelectorAll: vi.fn(() => []),
  };
  vi.stubGlobal("document", page);
});

afterEach(() => vi.unstubAllGlobals());

const openEntry = async (pathname: string) => {
  vi.stubGlobal("window", {
    location: { pathname },
    matchMedia: vi.fn(() => ({ matches: true })),
  });
  await import("./main.js");
};

describe("real browser entry dispatch over a prerendered landing", () => {
  it.each([
    ["/catalog", "catalog", "Каталог услуг — ии-Тоня", "bindCatalog"],
    ["/account", "account", "Личный кабинет — ии-Тоня", "bindPrivacy"],
    ["/consent", "consent", "Согласия — ии-Тоня", "bindPrivacy"],
    ["/my-data", "my-data", "Мои данные — ии-Тоня", "bindPrivacy"],
  ] as const)(
    "%s replaces the landing and binds its own actions",
    async (path, content, title, binder) => {
      await openEntry(path);
      await vi.waitFor(() => expect(page.title).toBe(title));
      expect(root.innerHTML).toBe(`<main>${content}</main>`);
      expect(views[binder]).toHaveBeenCalledExactlyOnceWith(root);
      expect(
        binder === "bindCatalog" ? views.bindPrivacy : views.bindCatalog,
      ).not.toHaveBeenCalled();
      expect(views.landing).not.toHaveBeenCalled();
      expect(page.querySelectorAll).not.toHaveBeenCalled();
      expect(
        [views.catalog, views.account, views.privacy, views.data].reduce(
          (count, render) => count + render.mock.calls.length,
          0,
        ),
      ).toBe(1);
    },
  );

  it("normalizes trailing slashes before choosing the account route", async () => {
    await openEntry("/account///");
    await vi.waitFor(() => expect(views.bindPrivacy).toHaveBeenCalledOnce());
    expect(root.innerHTML).toBe("<main>account</main>");
    expect(page.title).toBe("Личный кабинет — ии-Тоня");
  });

  it("preserves the server-rendered landing on the home route", async () => {
    await openEntry("/");
    expect(root.innerHTML).toBe(prerenderedLanding);
    expect(page.querySelectorAll).toHaveBeenCalledWith("[data-reveal]");
    expect(views.landing).not.toHaveBeenCalled();
    expect(views.bindCatalog).not.toHaveBeenCalled();
    expect(views.bindPrivacy).not.toHaveBeenCalled();
  });
});
