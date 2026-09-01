const landingRoot = '<main id="app"></main>';

export function injectLandingMarkup(
  document: string,
  landingMarkup: string,
): string {
  if (!document.includes(landingRoot)) {
    throw new Error("landing_prerender_root_missing");
  }
  return document.replace(
    landingRoot,
    `<main id="app" data-prerendered="true">${landingMarkup}</main>`,
  );
}
