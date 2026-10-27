import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("web_root_missing");
const root = app;

const route = window.location.pathname.replace(/\/+$/u, "") || "/";
const legalRoute: "oferta" | "privacy" | undefined =
  route === "/oferta" ? "oferta" : route === "/privacy" ? "privacy" : undefined;

async function initialize(): Promise<void> {
  if (route === "/expert/account") {
    const { renderExpertAccountPage, bindExpertAccountActions } =
      await import("./expert-account-view.js");
    root.innerHTML = renderExpertAccountPage();
    bindExpertAccountActions(root);
    document.title = "Кабинет эксперта — ии-Тоня";
    return;
  }
  if (route === "/demo") {
    const { renderDemoWalkthrough, bindDemoWalkthrough } =
      await import("./demo-walkthrough.js");
    root.innerHTML = renderDemoWalkthrough();
    bindDemoWalkthrough(root);
    document.title = "Интерактивное демо — ии-Тоня";
    return;
  }
  if (route === "/catalog") {
    const { renderCatalogPage, bindCatalogActions } =
      await import("./catalog-view.js");
    root.innerHTML = renderCatalogPage();
    bindCatalogActions(root);
    document.title = "Каталог услуг — ии-Тоня";
    return;
  }
  if (route === "/consent" || route === "/my-data" || route === "/account") {
    const {
      renderConsentPage,
      renderMyDataPage,
      renderAccountPage,
      bindPrivacyActions,
    } = await import("./consent-view.js");
    root.innerHTML =
      route === "/consent"
        ? renderConsentPage()
        : route === "/my-data"
          ? renderMyDataPage()
          : renderAccountPage();
    bindPrivacyActions(root);
    document.title =
      route === "/consent"
        ? "Согласия — ии-Тоня"
        : route === "/my-data"
          ? "Мои данные — ии-Тоня"
          : "Личный кабинет — ии-Тоня";
    return;
  }
  if (legalRoute !== undefined) {
    const { renderLegalPage } = await import("./legal-view.js");
    root.innerHTML = renderLegalPage(legalRoute);
    document.title =
      legalRoute === "oferta"
        ? "Договор-оферта — ии-Тоня"
        : "Политика конфиденциальности — ии-Тоня";
    return;
  }

  if (root.dataset.prerendered !== "true") {
    const [{ readPublicConfig }, { renderLanding }] = await Promise.all([
      import("./config.js"),
      import("./landing-view.js"),
    ]);
    root.innerHTML = renderLanding(
      readPublicConfig({
        VITE_EXPERT_CHAT_URL: import.meta.env.VITE_EXPERT_CHAT_URL,
      }),
    );
  }
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const revealElements =
    document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (reducedMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8%", threshold: 0.08 },
    );
    revealElements.forEach((element) => observer.observe(element));
  }
}

void initialize();
