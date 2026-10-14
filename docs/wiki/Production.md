# Production-контур

## Сервер и способ доставки

| Параметр              | Значение                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Хост                  | ii-tonya.ru / www.ii-tonya.ru (157.22.187.237)                                                         |
| ОС и ресурсы          | Ubuntu 24.04, 1 CPU, 1 GiB RAM, 15 GiB SSD                                                             |
| Контейнеры приложения | нет (native runtime)                                                                                   |
| Процесс               | systemd: `ii-tonya-api`, `ii-tonya-worker`, `ii-tonya-migrate`                                         |
| БД                    | системный PostgreSQL                                                                                   |
| Front                 | nginx + Let's Encrypt, `root /opt/ii-tonya-platform/web-current`, `/v1/` и `/health/` → 127.0.0.1:3000 |
| Артефакт              | `native-release.tar.gz` + SPDX SBOM + provenance.json + detached cosign `.sig`                         |
| Задеплоенный SHA      | `cb07bd1821d8106b0b0088b17bcf305662a1b792` (2026-09-18); previous `7498ce656e1e49fe2d92c83f02d9667eb3f86b9b` |
| Статус записи         | «recovered, not reproducible»                                                                          |

Исходники пути доставки: [`deploy/nginx/ii-tonya`](https://github.com/Dimkox/ii-tonya-platform/blob/main/deploy/nginx/ii-tonya), [`deploy/systemd/ii-tonya-api.service`](https://github.com/Dimkox/ii-tonya-platform/blob/main/deploy/systemd/ii-tonya-api.service),
[`scripts/deploy-native-remote.sh`](https://github.com/Dimkox/ii-tonya-platform/blob/main/scripts/deploy-native-remote.sh), [`scripts/build-native-release.sh`](https://github.com/Dimkox/ii-tonya-platform/blob/main/scripts/build-native-release.sh),
[`docs/runbooks/native-production-deployment.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/native-production-deployment.md).

## Проверено 10.09.2026

```
GET  https://ii-tonya.ru/                    200  nginx/1.24.0 (Ubuntu), SPA 1604 B, Last-Modified 27.08
GET  /health/live                            200  {"status":"live"}
GET  /health/ready                           200  {"status":"ready","checks":{"postgres":true,"migrations":true,"workerLease":true,"adapters":true}}
GET  /v1/expert/residency/tariffs            404  (fail-closed: маршруты эксперта не регистрируются)
GET  /oferta /policy /pricing /booking       200  один и тот же index.html (клиентская маршрутизация)
sha256sum -c native-release.sha256           OK   (тар, SBOM, provenance)
```

Контрольные суммы задеплоенного релиза:

```
1aa118aefdca66c8d9d6f73346872d99f04c19d034661465defe170c4ddd0741  native-release.tar.gz
8833e49d5f44b2494ea6f1df44a22ccdaad299190bfe0c226909df92982b286f  native-release.spdx.json
029bd3183617892857fa0134a402d4162490ee27367cf376ba4cf9dfdd5f2263  native-release.provenance.json
```

## Что не так

| Проблема                                                                       | Issue                                                                                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Прод на 33 коммита позади main; требуется corrected exact-SHA replacement      | [https://github.com/Dimkox/ii-tonya-platform/issues/48](https://github.com/Dimkox/ii-tonya-platform/issues/48) |
| `PermitRootLogin yes` + `PasswordAuthentication yes` (осознанно, PR #15)       | [https://github.com/Dimkox/ii-tonya-platform/issues/49](https://github.com/Dimkox/ii-tonya-platform/issues/49) |
| Bootstrap-скрипты и артефакты вне VCS, единственная копия                      | [https://github.com/Dimkox/ii-tonya-platform/issues/50](https://github.com/Dimkox/ii-tonya-platform/issues/50) |
| Не было ни одного tag/release (первый заведён вручную)                         | [https://github.com/Dimkox/ii-tonya-platform/issues/58](https://github.com/Dimkox/ii-tonya-platform/issues/58) |
| Веб-статика (27.08) новее API-релиза (14.08)                                   | [https://github.com/Dimkox/ii-tonya-platform/issues/59](https://github.com/Dimkox/ii-tonya-platform/issues/59) |
| Миграционный approval подменяется `sed` в `/etc/ii-tonya/runtime.env` на хосте | [https://github.com/Dimkox/ii-tonya-platform/issues/49](https://github.com/Dimkox/ii-tonya-platform/issues/49) |

## Доступ к продакшену из этой машины

Claw 2026-09-17: hostname `ii-tonya.ru` pinned (ED25519
`SHA256:eHiplIy7STE3UhwVa0EozOSIysMNUQNtTKilwWdrrTE`), BatchMode `ii_tonya`
deploy key installed. Evidence:
[`docs/test-evidence/production/host-identity-2026-09-17.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/test-evidence/production/host-identity-2026-09-17.md).
Interactive root password login remains enabled; the password is not stored.

`bootstrap-ii-tonya-deploy.ps1` (Windows) → base64-пейлод, побайтово равный
`bootstrap-ii-tonya-remote.sh`: кладёт deploy-ключ в `~ii_tonya/.ssh/authorized_keys`, создаёт
sudoers `ii_tonya ALL=(root) NOPASSWD: install, systemctl, rm`, правит `MIGRATION_COMPATIBILITY_APPROVED_SHA`
и требует от sshd открытых root/password. Это единственные копии этих файлов — см. issue #50.

← [Home](Home.md) · [Гейты](Release-Gates.md)
