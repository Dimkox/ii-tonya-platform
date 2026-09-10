# S3 · Релизная инженерия: Actions → Claw, SBOM, native systemd прод

Milestone: [3](https://github.com/Dimkox/ii-tonya-platform/milestone/3) · Label: `stage:release-eng` · Статус: **АКТИВЕН**

## Цель этапа

Дать воспроизводимый путь «код → подписанный артефакт → прод» без hosted-минут GitHub, и задеплоить native runtime на выделенном сервере.

## Что вошло

- Workflow-контур (ci/db-gate/release, 725 строк) с cosign keyless-signing, trivy HIGH/CRITICAL --exit-code 1, gitleaks
- Перенос верификации в Claw-ферму (изолированные контейнеры) после удаления workflow с main
- native-release.tar.gz + SPDX SBOM + provenance.json + detached cosign .sig
- systemd-юниты api/worker/migrate + nginx + Let's Encrypt для ii-tonya.ru
- 26 каталогов evidence в docs/test-evidence/claw и production-запись деплоя

## Документация-источник (main)

- [`docs/runbooks/native-production-deployment.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/native-production-deployment.md)
- [`docs/spec/deployment-readiness-amendment.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/deployment-readiness-amendment.md)
- [`docs/testing/claw-container.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/testing/claw-container.md)
- [`docs/superpowers/sprint-change-proposal-2026-08-13-native-production.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/sprint-change-proposal-2026-08-13-native-production.md)
- [`docs/test-evidence/production/233f3cf72e45e47117948ad5615b603252801e40/deployment.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/test-evidence/production/233f3cf72e45e47117948ad5615b603252801e40/deployment.md)

## PR этапа

[#2](https://github.com/Dimkox/ii-tonya-platform/pull/2) · [#10](https://github.com/Dimkox/ii-tonya-platform/pull/10) · [#14](https://github.com/Dimkox/ii-tonya-platform/pull/14) · [#15](https://github.com/Dimkox/ii-tonya-platform/pull/15) · [#16](https://github.com/Dimkox/ii-tonya-platform/pull/16) · [#31](https://github.com/Dimkox/ii-tonya-platform/pull/31) · [#40](https://github.com/Dimkox/ii-tonya-platform/pull/40)

## Гейты и ограничения

Единственный production-деплой помечен «recovered, not reproducible»; требуется corrected exact-SHA replacement. `evidence_gate` в release.yml вычитает строки «Release status: GO» и «Provider staging status: PASS», а tests/repo/release-assets.test.ts запрещает выставлять PASS — обход через правку docs невозможен.

**Статус этапа:** АКТИВЕН · **Ключ этапа:** `S3` · **Label:** `stage:release-eng`

## Открытые вопросы этапа

[#6](https://github.com/Dimkox/ii-tonya-platform/issues/6) · [#47](https://github.com/Dimkox/ii-tonya-platform/issues/47) · [#48](https://github.com/Dimkox/ii-tonya-platform/issues/48) · [#49](https://github.com/Dimkox/ii-tonya-platform/issues/49) · [#50](https://github.com/Dimkox/ii-tonya-platform/issues/50) · [#51](https://github.com/Dimkox/ii-tonya-platform/issues/51) · [#58](https://github.com/Dimkox/ii-tonya-platform/issues/58)

## PR этапа

[#2](https://github.com/Dimkox/ii-tonya-platform/pull/2), [#10](https://github.com/Dimkox/ii-tonya-platform/pull/10), [#14](https://github.com/Dimkox/ii-tonya-platform/pull/14), [#15](https://github.com/Dimkox/ii-tonya-platform/pull/15), [#16](https://github.com/Dimkox/ii-tonya-platform/pull/16), [#31](https://github.com/Dimkox/ii-tonya-platform/pull/31), [#40](https://github.com/Dimkox/ii-tonya-platform/pull/40)

## Открытые issues этапа

[#6](https://github.com/Dimkox/ii-tonya-platform/issues/6), [#47](https://github.com/Dimkox/ii-tonya-platform/issues/47), [#48](https://github.com/Dimkox/ii-tonya-platform/issues/48), [#49](https://github.com/Dimkox/ii-tonya-platform/issues/49), [#50](https://github.com/Dimkox/ii-tonya-platform/issues/50), [#51](https://github.com/Dimkox/ii-tonya-platform/issues/51), [#58](https://github.com/Dimkox/ii-tonya-platform/issues/58)

← [все этапы](Stages.md) · [Home](Home.md)
