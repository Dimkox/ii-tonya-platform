import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("web_root_missing");
const root = app;

const route = window.location.pathname.replace(/\/+$/u, "") || "/";
const legalRoute: "oferta" | "privacy" | undefined =
  route === "/oferta" ? "oferta" : route === "/privacy" ? "privacy" : undefined;

async function initialize(): Promise<void> {
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
