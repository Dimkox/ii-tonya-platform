# Local semantic catalogue preparation (not implementation acceptance)

Primary references inspected on2026-10-27:

- https://github.com/natasha/navec — pretrained Russian GloVe/product-quantized
  word embeddings; author model downloads and loading contract.
- https://github.com/no-plagiarism/pymorphy3 — maintained Russian morphology.
- https://github.com/natasha/natasha — Russian tokenizer/morphology/embedding toolkit.
- https://huggingface.co/cointegrated/rubert-tiny2 — Russian312-dimensional CLS
  sentence encoder; alternate candidate, not downloaded/executed.
- https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
  and https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2 — multilingual
  384-dimensional mean-pooled encoder and published ONNX conversion.
- https://huggingface.co/docs/transformers.js/api/env — local-only loading controls.

All assets and packages here are temporary isolated research, outside Git/project
node_modules. No provider inference, private user data, PostgreSQL, production
activation, repository source change or claimed completed recommendation feature.

Navec0.10.0, pymorphy3 2.0.6, razdel0.5.0, numpy2.5.4 were resolved with exact
transitive versions and package hashes into requirements.txt, then installed in
this directory's venv. First compile selected inherited Python3.11 and failed
numpy's>=3.12 constraint; compile-python312.log explicitly uses /usr/bin/python3
3.12.3 and succeeds. No project Python environment or engine rule was changed.

Actual model downloads from publisher HTTPS:

- hudlit12B/500K/300d:53012480 bytes,
  SHA256 0a89ec8198d0ae9ee3bbb31bbf2c0115bf033e56a337b74d6ca1fe5623165446.
- news1B/250K/300d:26634240 bytes,
  SHA256 f07270833d78523edc5781538d67038e95b43975e4a7ae757c693b687f9cbfca.

Synthetic probes against all164 canonical tags and synonyms:

- hudlit:747 nonempty term vectors, cold0.825s, max simple warm lookup0.217ms,
  peak399654912 bytes. This is too close to384MiB to claim safe headroom.
- news:727 nonempty term vectors, cold0.520s, max simple warm lookup0.235ms,
  peak212262912 bytes. It is a plausible compact candidate, not an accepted
  end-to-end<500ms benchmark or a reason to co-locate it in the Node process.
- Both execute real300-dimensional pretrained vectors; no paidLLM or synthetic
  hash embeddings. News probe demonstrates non-identical phrase cosine0.902591
  for 'уверенность в себе' vs canonical synonym 'неуверенность в себе'. This is
  advisory related meaning, never a diagnosis/competence claim.
- Probe averages known words and can silently drop an unknown qualifier: e.g.
  unknown 'хатха' collapses its phrase toward 'йога'. DO NOT ship this probe as
  production logic. Production must track complete meaningful-word coverage,
  decline unknown phrases, preserve negation/context, and always require owner
  confirmation. Exact/synonym matching has weight100; semantic strictly>.85 weight50.
  Full ranking/top15/cache/revision/consent/UI is not implemented here.

Alternative published MiniLM ONNX metadata is retained in minilm-metadata.json:
revision2c4055b12046f11709e9df2c122e59ffbdc2f900,
quantized ONNX118308126 bytes SHA256
66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc;
tokenizer17082913 bytes SHA256
b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441.
This candidate was not downloaded or executed. Do not claim measured performance.

S3b remains after S3a implementation acceptance. Choose/prove the compact local
model using source scope and measured bounded isolated runtime. Retain exact bytes/
versions, no runtime downloads or model binaries committed; startup or taxonomy
revision rebuilds public catalogue cache. Do not persist private query strings in
shared model caches. Missing/corrupt cache/model has explicit exact-only/manual
fallback, never fabricated semantic confidence. Actual helper/worker composition,
changed catalogue/cache invalidation and warm end-to-end performance need witnesses.

License/provenance follow-up: upstream https://github.com/natasha/navec/blob/master/LICENSE
is MIT for software; preserve its notice with any redistributed helper. The model
README identifies both download origins and corpora; do not mislabel a locally
computed model digest as an upstream signature. The news model is intended for news
and has narrower vocabulary than hudlit. These are candidates, not an accepted
model decision. https://huggingface.co/cointegrated/rubert-tiny2 identifies MIT and
Russian sentence embeddings; no local benchmark of that alternative is claimed.

A second bounded synthetic news-model probe (`probe-covered-news.py/.json/.log`)
rejects a phrase if any alphabetical token has no original/lemma vector instead
of silently dropping it. It ran once in0.686s process wall time; cold0.601s,
688 retained catalogue terms, peak212361216 bytes. Pure lookup warm max0.309ms
is still NOT the required application/DB/helper end-to-end benchmark.
Useful genuinely nonidentical full-coverage examples: невысокая самооценка ->
низкая самооценка cosine0.872351; проблемы в отношениях -> кризис в отношениях
0.866688. Exact normalized matches must still score100 in production, not be
presented as semantic50. Counterexample: работа с эмоциями is close to работа
с мыслями0.920467 and may propose КПТ without supporting methodological expertise;
therefore suggestions MUST remain explicitly advisory/owner-and-manager confirmed,
never clinical qualification inference. Negation/context must be retained. This
prototype remains research, not a complete tokenization/security/runtime solution.
