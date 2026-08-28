# Mistakes

Focused verification omitted `legal-view.test.ts`, leaving a stale policy-heading assertion; the full web suite caught it.

The deployment review checked only the currently served HTML/JavaScript and inferred that there was no analytics requirement. The root cause was failing to inspect Git history, where the approved Yandex Metrika counter already existed and had later been removed by a wholesale `index.html` rewrite.
