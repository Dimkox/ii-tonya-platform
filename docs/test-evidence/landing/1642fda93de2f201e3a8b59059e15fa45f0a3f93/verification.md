# Landing verification — `1642fda93de2f201e3a8b59059e15fa45f0a3f93`

Product commit: `1642fda93de2f201e3a8b59059e15fa45f0a3f93`

Date: 2026-09-01 UTC

## Automated gates

Executed from `apps/web`:

```text
npm run typecheck  PASS
npm test           PASS — 9 files, 43 tests
npm run build      PASS — Vite 7.3.6
```

Production artifact facts:

- `dist/index.html`: 41.92 KB raw / 9.85 KB gzip; contains H1, all 20 FAQ items, canonical metadata and JSON-LD before JavaScript execution.
- First-load module: 3.01 KB raw / 1.58 KB gzip, below the 15 KB skill budget.
- Legal and fallback-render chunks are route/lifecycle lazy-loaded and do not load on the pre-rendered landing.
- Local favicon, responsive AVIF/WebP/PNG hero variants, robots and sitemap all exist in `dist/`.

## HTML and structured data

The built `dist/index.html` was submitted as UTF-8 HTML to the W3C Nu validator:

```text
curl --header 'Content-Type: text/html; charset=utf-8' \
  --data-binary @dist/index.html 'https://validator.w3.org/nu/?out=json'
errors: 0
```

Raw response: `apps/web/reports/nu-validator.json`.

JSON-LD parses in `src/seo-shell.test.ts` and contains only `WebSite`, `Organization`, and `FAQPage`. `LocalBusiness`, `AggregateRating`, and `Review` are deliberately absent because the project has not supplied the required facts.

## Responsive browser evidence

Google Chrome full-page screenshots:

- `apps/web/reports/responsive/landing-320.jpg`
- `apps/web/reports/responsive/landing-768.jpg`
- `apps/web/reports/responsive/landing-1280.jpg`
- `apps/web/reports/responsive/landing-1920.jpg`

At each width, browser evaluation reported `scrollWidth == clientWidth`, one H1, 20 details elements and no page errors. Visual inspection found no clipped content or broken reflow. Keyboard focus styles, native FAQ controls and reduced-motion behavior are covered by focused tests; this is evidence for the tested flows, not a blanket WCAG certification.

## Lighthouse 13.4.1

Command profile:

```text
npx --yes lighthouse@13.4.1 http://127.0.0.1:4173/ \
  --output=json --chrome-flags='--headless --no-sandbox' --quiet
```

Three current-product raw reports:

- `apps/web/reports/lighthouse/current-run-1.json`
- `apps/web/reports/lighthouse/current-run-2.json`
- `apps/web/reports/lighthouse/current-run-3.json`

Median results:

| Metric | Median |
|---|---:|
| Performance | 100 |
| Accessibility | 100 |
| Best Practices | 96 |
| SEO | 100 |
| FCP | 1.103 s |
| LCP | 1.352 s |
| CLS | 0 |
| Total Blocking Time | 0 ms |

The third run showed the expected external-analytics variance (Performance 96, Best Practices 77, TBT 215.5 ms). Best Practices is reduced by Yandex Metrika third-party-cookie/DevTools findings; counter `111827123` is intentionally preserved by explicit product-owner requirement and documented in `apps/web/DEPENDENCIES.md`. These are local Lighthouse lab measurements, not field Core Web Vitals.

## Rollback

Revert commits from the SEO landing series. No backend, database, payment, messaging or production-provider state is changed by this landing release.
