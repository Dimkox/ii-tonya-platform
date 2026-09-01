# Public page third-party dependencies

The page uses no external UI library or web font. The following analytics
dependency is retained by explicit product-owner requirement.

| Origin | Path | Purpose | Activation | Owner | CSP destinations | Notes |
|---|---|---|---|---|---|---|
| `https://mc.yandex.ru` | `/metrika/tag.js?id=111827123` and counter endpoints | Yandex Metrika analytics | First page load | ии-Тоня project owner | `script-src`, `img-src`, `connect-src` | Mutable vendor URL; SRI is not possible. The page therefore does not claim zero third-party requests on first load. |
