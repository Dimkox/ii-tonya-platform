const landingRoot = '<div id="app"></div>';

export function injectLandingMarkup(
  document: string,
  landingMarkup: string,
): string {
  if (!document.includes(landingRoot)) {
    throw new Error("landing_prerender_root_missing");
  }
  return document.replace(
    landingRoot,
    `<div id="app" data-prerendered="true">${landingMarkup}</div>`,
  );
}
