# Сверка с существующим кодом

База: `18af66fef61c33d21216c3b24f935cb1fe3d7b2d`. Проведено чтение файлов и поиск; наличие реализации/тестов не означает, что новая спецификация уже выполнена или провайдер запущен.

## Клиентская коммерческая модель

В коде сосуществуют legacy_package_v1 и free_client_v2; conversation-service выбирает free для V2. Файлы владельца снова описывают платные абонементы. Нельзя заменить назначенную политику всем существующим клиентам без решения и миграционного контракта.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/application/src/client-commercial-policy.ts](../../../packages/application/src/client-commercial-policy.ts)
- [packages/application/src/conversation-service.ts](../../../packages/application/src/conversation-service.ts)
- [packages/db/migrations/0032_commercial_core_v2_a1.sql](../../../packages/db/migrations/0032_commercial_core_v2_a1.sql)

**Существующие тесты:**

- [packages/application/src/client-commercial-policy.test.ts](../../../packages/application/src/client-commercial-policy.test.ts)
- [packages/application/src/conversation-service.test.ts](../../../packages/application/src/conversation-service.test.ts)

**Пробелы:**

- Нужен выбор целевой модели и когорт; готовность live не проверялась.

## Классификация и выбор пакета сообщений

chargeDelta списывает ordinary_inbound/outbound; system/safety/error бесплатны. choosePackage выбирает неистёкшие пакеты, intro после платных, затем срок окончания, grantedAt и ID. Intro в схеме 100 бессрочных сообщений.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/domain/src/billing.ts](../../../packages/domain/src/billing.ts)
- [packages/db/src/schema/billing.ts](../../../packages/db/src/schema/billing.ts)

**Существующие тесты:**

- [packages/domain/src/billing.test.ts](../../../packages/domain/src/billing.test.ts)
- [packages/domain/src/billing.property.test.ts](../../../packages/domain/src/billing.property.test.ts)

**Пробелы:**

- Источник требует тарифицировать все сообщения, 80–100 intro и другой FIFO; конфликт требует решения.

## Экспертские тарифы V2

SQL ограничивает V2 тарифами START 3900, BASE 5900, PRO 9990 рублей, длительностью 2592000 секунд, cap 3000 bps и квотами групп 0/1/3. Новый персональный тариф не помещается в действующие CHECK constraints; нужна новая версия политики и ручная миграция, не правка исторического SQL.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/db/migrations/0032_commercial_core_v2_a1.sql](../../../packages/db/migrations/0032_commercial_core_v2_a1.sql)
- [packages/application/src/expert-residency-service.ts](../../../packages/application/src/expert-residency-service.ts)
- [packages/application/src/expert-referral-admin-service.ts](../../../packages/application/src/expert-referral-admin-service.ts)

**Существующие тесты:**

- [packages/application/src/expert-residency-service.test.ts](../../../packages/application/src/expert-residency-service.test.ts)
- [packages/application/src/expert-referral-admin-service.test.ts](../../../packages/application/src/expert-referral-admin-service.test.ts)

**Пробелы:**

- Нет проверенной реализации новой персональной формулы/акции/пола цены.

## Реферальная арифметика

quoteResidency принимает cap; значение по умолчанию 5000 bps относится к общему/legacy пути. V2 SQL отдельно фиксирует 3000 bps. Есть FIFO, 365-дневный срок, reversals/debt и зрелость A2. Новое 3-месячное удержание акции и cap 10% для SPACE не подтверждены.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/domain/src/expert-referral.ts](../../../packages/domain/src/expert-referral.ts)
- [packages/db/src/repositories/expert-referral-repository.ts](../../../packages/db/src/repositories/expert-referral-repository.ts)
- [packages/db/migrations/0033_expert_referral_maturity_a2.sql](../../../packages/db/migrations/0033_expert_referral_maturity_a2.sql)

**Существующие тесты:**

- [packages/domain/src/expert-referral.test.ts](../../../packages/domain/src/expert-referral.test.ts)
- [packages/domain/src/expert-referral.property.test.ts](../../../packages/domain/src/expert-referral.property.test.ts)
- [packages/db/src/repositories/expert-referral-repository.test.ts](../../../packages/db/src/repositories/expert-referral-repository.test.ts)

**Пробелы:**

- Не переобъявлять уже существующие 30% V2 новой реализацией; проверить расширение на категории/акции.

## Тарифы центра и организатора

calculatePartnerShadowQuote использует >=6 и >=10, +3000 online-only, +5000 million-city, квоты CENTER 10×30 и ORGANIZER 5×50/3×100/1×500, комиссии 10%/15% и 4500 за карточку. Калькулятор shadow; наличие функции не доказывает активную продажу.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/domain/src/partner-pricing.ts](../../../packages/domain/src/partner-pricing.ts)
- [packages/db/src/schema/partner-commerce.ts](../../../packages/db/src/schema/partner-commerce.ts)
- [packages/db/migrations/0037_partner_commerce_a.sql](../../../packages/db/migrations/0037_partner_commerce_a.sql)

**Существующие тесты:**

- [packages/domain/src/partner-pricing.test.ts](../../../packages/domain/src/partner-pricing.test.ts)
- [packages/db/src/repositories/partner-commerce-repository.test.ts](../../../packages/db/src/repositories/partner-commerce-repository.test.ts)

**Пробелы:**

- Ровно 5 экспертов и состав квалификации требуют решения; акционные цены и SPACE не представлены в типе.

## Проверка пробного экспертского доступа

Пробный доступ резервирует по 2 units с лимитом 100; warmup потребляет 0. Сегментация содержит EXPERT/CENTER/ORGANIZER, SPACE отсутствует. Текст source-main смешивает коммерческую демонстрацию с платной клиентской тарификацией.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/db/src/repositories/test-expert-trial-repository.ts](../../../packages/db/src/repositories/test-expert-trial-repository.ts)
- [packages/application/src/test-expert-warmup.ts](../../../packages/application/src/test-expert-warmup.ts)
- [packages/application/src/test-expert-segmentation.ts](../../../packages/application/src/test-expert-segmentation.ts)
- [packages/application/src/test-expert-telegram-service.ts](../../../packages/application/src/test-expert-telegram-service.ts)

**Существующие тесты:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../packages/application/src/test-expert-telegram-service.test.ts)
- [packages/db/src/repositories/test-expert-trial-repository.test.ts](../../../packages/db/src/repositories/test-expert-trial-repository.test.ts)

**Пробелы:**

- Нужна изоляция виртуальных демо-цен/купонного баланса и реальных booking/payments.

## Точка входа «тест эксперт» и детерминированная анкета

Найдены распознавание «тест эксперт»/`/test_expert`, версия сессии, сбор имени, специализации и сегмента, а также маршрутизация через Telegram webhook. Текст — намеренно неактивный placeholder, не полный продажный сценарий строк 3051–4271.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/application/src/test-expert-telegram-service.ts](../../../packages/application/src/test-expert-telegram-service.ts)
- [apps/api/src/routes/telegram-webhook.ts](../../../apps/api/src/routes/telegram-webhook.ts)

**Существующие тесты:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../packages/application/src/test-expert-telegram-service.test.ts)
- [apps/api/src/routes/telegram-webhook.test.ts](../../../apps/api/src/routes/telegram-webhook.test.ts)

**Пробелы:**

- Нет найденной реализации этапов демо-экспертов, FAQ эксперта по источнику, возражений, менеджерской встречи и передачи анкеты менеджеру.

## История диалога, одноразовая детерминированная доставка и fail-closed режим

Сессия хранит version/state, а детерминированные ответы передаются через транзакционную доставку; двусмысленная идентичность и отсутствие согласия дают unavailable. Это покрывает техническую основу части B021/B022/B039, но не проверяет маркетинговые правила ответов.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/application/src/test-expert-telegram-service.ts](../../../packages/application/src/test-expert-telegram-service.ts)
- [packages/db/src/repositories/test-expert-telegram-repository.ts](../../../packages/db/src/repositories/test-expert-telegram-repository.ts)

**Существующие тесты:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../packages/application/src/test-expert-telegram-service.test.ts)
- [tests/repo/test-expert-telegram-repository-guards.test.ts](../../../tests/repo/test-expert-telegram-repository-guards.test.ts)

**Пробелы:**

- Нет найденной проверки орфографии/грамматики исходящих сообщений и правила «каждый ответ заканчивается вопросом или действием».

## Купоны клиента и демонстрация фиксированных 3000/1000/2000

В inspected paths тестовый экспертский диалог и trial schema не содержат клиентской купонной модели или демо-значений 3 000, 1 000, 2 000.

**Статус:** `not_found_in_inspected_paths`.

**Проверенные файлы:**

- [packages/application/src/test-expert-telegram-service.ts](../../../packages/application/src/test-expert-telegram-service.ts)
- [packages/db/src/schema/test-expert-trial.ts](../../../packages/db/src/schema/test-expert-trial.ts)

**Существующие тесты:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../packages/application/src/test-expert-telegram-service.test.ts)
- [tests/integration/test-expert-trial-postgres.test.ts](../../../tests/integration/test-expert-trial-postgres.test.ts)

**Пробелы:**

- Поиск ограничен путями тестового экспертского сценария и схемы trial; наличие иной клиентской coupon-подсистемы этой записью не исключается.

## Клиентское бронирование и резерв

Найдены отдельные application/API/repository границы клиентского бронирования. Они требуют отдельного сопоставления с источником, включая окно 24 часа, резерв 72 часа, лист ожидания и три напоминания.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/application/src/client-booking-service.ts](../../../packages/application/src/client-booking-service.ts)
- [apps/api/src/routes/client-booking.ts](../../../apps/api/src/routes/client-booking.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../packages/db/src/repositories/booking-repository.ts)

**Существующие тесты:**

- [packages/application/src/client-booking-service.test.ts](../../../packages/application/src/client-booking-service.test.ts)
- [tests/integration/client-booking-repository.test.ts](../../../tests/integration/client-booking-repository.test.ts)
- [tests/e2e/client-booking-boundary.test.ts](../../../tests/e2e/client-booking-boundary.test.ts)

**Пробелы:**

- Эта сверка не подтверждает соответствие всех временных чисел и купонных последствий отмены.

## Персональная цена тестового эксперта

Найдена выдача предварительной авторитетной цены после сегментации, но inspected code не подтверждает формулу 12 000/20 000, 16 городов, −1 000, +5 000, +3 000 и шкалу 8/9/10/12 тыс. из B024–B029.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/db/src/repositories/test-expert-pricing-policy.ts](../../../packages/db/src/repositories/test-expert-pricing-policy.ts)
- [packages/application/src/test-expert-telegram-service.ts](../../../packages/application/src/test-expert-telegram-service.ts)

**Существующие тесты:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../packages/application/src/test-expert-telegram-service.test.ts)
- [tests/integration/test-expert-trial-postgres.test.ts](../../../tests/integration/test-expert-trial-postgres.test.ts)

**Пробелы:**

- Нет подтверждения полного набора полей расчёта и конфликтующих лимитов бонусов 20%/30%.

## Экспертское резидентство и тарифные версии

Найдены версии тарифов, заказы резидентства и поля individualServicesEnabled/groupEventLimit. Значения и коммерческая политика в коде относятся к действующей V2-модели, поэтому они не подтверждают оферту B009/B069 автоматически.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/application/src/expert-residency-service.ts](../../../packages/application/src/expert-residency-service.ts)
- [packages/db/src/schema/expert-residency.ts](../../../packages/db/src/schema/expert-residency.ts)
- [packages/db/src/repositories/expert-residency-repository.ts](../../../packages/db/src/repositories/expert-residency-repository.ts)

**Существующие тесты:**

- [packages/application/src/expert-residency-service.test.ts](../../../packages/application/src/expert-residency-service.test.ts)
- [tests/integration/expert-residency-tariff-discovery.test.ts](../../../tests/integration/expert-residency-tariff-discovery.test.ts)
- [tests/integration/expert-residency-checkout.test.ts](../../../tests/integration/expert-residency-checkout.test.ts)

**Пробелы:**

- Нет подтверждения исходных публичных тарифов 12 000 и 20 000, setup fee 3 000 и полного правила перерыва 3 месяца.

## Групповые мероприятия и их процентная модель

В schema/repository имеются groupEventLimit, а в web content присутствует маркетинговый блок оплаты групп. Не найдена в inspected runtime реализация расчётной выручки, брони, остатка, отчёта и срока оплаты 5 рабочих дней.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/db/src/schema/expert-residency.ts](../../../packages/db/src/schema/expert-residency.ts)
- [packages/db/src/repositories/expert-residency-repository.ts](../../../packages/db/src/repositories/expert-residency-repository.ts)
- [apps/web/src/content.ts](../../../apps/web/src/content.ts)

**Существующие тесты:**

- [tests/integration/expert-residency-tariff-discovery.test.ts](../../../tests/integration/expert-residency-tariff-discovery.test.ts)
- [apps/web/src/content.test.ts](../../../apps/web/src/content.test.ts)

**Пробелы:**

- Нет найденной исполнимой модели 10%/15%+4 500 и разрешения конфликта 30% услуги против 30% выручки.

## Лендинг: контент, CTA и тарифные секции

Найдены централизованный контент и HTML-представление лендинга с CTA «тест клиент»/«тест эксперт», пакетами, тарифами, FAQ, контактами и порядком оплаты мероприятий. Это предметно близко к B042–B050, но часть чисел и формулировок должна проверяться построчно против extract-b.

**Статус:** `partial`.

**Проверенные файлы:**

- [apps/web/src/content.ts](../../../apps/web/src/content.ts)
- [apps/web/src/landing-view.ts](../../../apps/web/src/landing-view.ts)
- [apps/web/src/config.ts](../../../apps/web/src/config.ts)

**Существующие тесты:**

- [apps/web/src/content.test.ts](../../../apps/web/src/content.test.ts)
- [apps/web/src/landing-view.test.ts](../../../apps/web/src/landing-view.test.ts)
- [apps/web/src/config.test.ts](../../../apps/web/src/config.test.ts)

**Пробелы:**

- Не подтверждены все 20 FAQ, полные реквизиты блоков, выбранная палитра, SEO и все поля контактной формы.

## Лендинг: реализация визуального HTML/CSS/адаптивности

Найдены view и stylesheet в web-приложении; их существование подтверждает отдельный presentation layer. Эта быстрая сверка не доказывает точное соблюдение трёх палитр, размеров dialog-компонента, Intersection Observer, mobile breakpoint 768px и SEO B051–B055.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [apps/web/src/landing-view.ts](../../../apps/web/src/landing-view.ts)
- [apps/web/src/styles.css](../../../apps/web/src/styles.css)

**Существующие тесты:**

- [apps/web/src/landing-view.test.ts](../../../apps/web/src/landing-view.test.ts)

**Пробелы:**

- Нужна визуальная и DOM-проверка против точных дизайнерских значений исходника.

## Оферта и политика на web-слое

Найдены опубликованные текстовые legal assets и их сборка в web content. Они являются материалом для публикации; совпадение каждого юридического правила B056–B089 требует отдельной юридической и построчной проверки.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [apps/web/src/legal-content.ts](../../../apps/web/src/legal-content.ts)
- [apps/web/src/legal/oferta.txt](../../../apps/web/src/legal/oferta.txt)
- [apps/web/src/legal/policy.txt](../../../apps/web/src/legal/policy.txt)

**Существующие тесты:**

- [apps/web/src/legal-content.test.ts](../../../apps/web/src/legal-content.test.ts)

**Пробелы:**

- Не подтверждаются правовая действительность, юридическая применимость и отсутствие конфликтов 20%/30%, напоминаний и реферального момента начисления.

## Остаточный AI-триал, лимиты и reconciliation

Найдены нулевые единицы для детерминированного warmup, резерв 2 единиц на residual turn, авторитетные исходы и bounded reconciliation. Это относится к текущему безопасному «тест эксперт» фундаменту, но не реализует продажный скрипт или клиентскую/экспертскую купонную механику этого диапазона.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/application/src/test-expert-telegram-service.ts](../../../packages/application/src/test-expert-telegram-service.ts)
- [packages/db/src/repositories/test-expert-trial-repository.ts](../../../packages/db/src/repositories/test-expert-trial-repository.ts)
- [packages/worker/src/test-expert-trial-reconciliation.ts](../../../packages/worker/src/test-expert-trial-reconciliation.ts)

**Существующие тесты:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../packages/application/src/test-expert-telegram-service.test.ts)
- [tests/integration/test-expert-trial-postgres.test.ts](../../../tests/integration/test-expert-trial-postgres.test.ts)
- [packages/worker/src/test-expert-trial-reconciliation.test.ts](../../../packages/worker/src/test-expert-trial-reconciliation.test.ts)

**Пробелы:**

- Нужна проверка включения флагов и внешней provider-capability; они не следуют только из наличия исходных файлов.

## Экспертские Telegram-команды /schedule, /client и /stats

Найдена отдельная реализованная ветка private expert query commands. Она относится к Story 24.1 и не является реализацией демонстрации, менеджерского хэнд-оффа или ценовых правил диапазона B.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/integrations/src/telegram/expert-command-processor.ts](../../../packages/integrations/src/telegram/expert-command-processor.ts)
- [apps/api/src/routes/telegram-webhook.ts](../../../apps/api/src/routes/telegram-webhook.ts)
- [packages/db/src/repositories/expert-telegram-query-repository.ts](../../../packages/db/src/repositories/expert-telegram-query-repository.ts)

**Существующие тесты:**

- [packages/integrations/src/telegram/expert-command-processor.test.ts](../../../packages/integrations/src/telegram/expert-command-processor.test.ts)
- [apps/api/src/routes/telegram-webhook.test.ts](../../../apps/api/src/routes/telegram-webhook.test.ts)

**Пробелы:**

- Требуется отдельное сопоставление с Story 24.1; связь с B-claims не предполагается.

## Planerka contract boundary

Есть типизированный порт Planerka, disabled-адаптер и доменная модель резерва; живой адаптер не подтверждён просмотром.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/integrations/src/planerka/planerka-port.ts](../../../packages/integrations/src/planerka/planerka-port.ts)
- [packages/integrations/src/planerka/disabled-planerka-adapter.ts](../../../packages/integrations/src/planerka/disabled-planerka-adapter.ts)
- [packages/domain/src/reservation.ts](../../../packages/domain/src/reservation.ts)

**Существующие тесты:**

- [tests/contract/planerka-port.test.ts](../../../tests/contract/planerka-port.test.ts)
- [packages/domain/src/reservation.test.ts](../../../packages/domain/src/reservation.test.ts)
- [tests/integration/booking-concurrency.test.ts](../../../tests/integration/booking-concurrency.test.ts)

**Пробелы:**

- Требование source Reserved на 72 часа → Booked/Cancelled требует сверки маппинга статусов и API после решения владельца.

## Client booking API and persistence

Существуют API, application service, PostgreSQL repository и schema для клиентского бронирования.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [apps/api/src/routes/client-booking.ts](../../../apps/api/src/routes/client-booking.ts)
- [packages/application/src/client-booking-service.ts](../../../packages/application/src/client-booking-service.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../packages/db/src/repositories/booking-repository.ts)
- [packages/db/src/schema/booking.ts](../../../packages/db/src/schema/booking.ts)

**Существующие тесты:**

- [apps/api/src/routes/client-booking.test.ts](../../../apps/api/src/routes/client-booking.test.ts)
- [packages/application/src/client-booking-service.test.ts](../../../packages/application/src/client-booking-service.test.ts)
- [tests/integration/client-booking-repository.test.ts](../../../tests/integration/client-booking-repository.test.ts)

**Пробелы:**

- Новые правила space slots и Planerka должны быть отдельной оценкой, не выведены из наличия booking-кода.

## Reservation expiry

Есть worker-задача истечения резервов и тестируемая доменная модель.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/worker/src/reservation-expiry.ts](../../../packages/worker/src/reservation-expiry.ts)
- [packages/domain/src/reservation.ts](../../../packages/domain/src/reservation.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../packages/db/src/repositories/booking-repository.ts)

**Существующие тесты:**

- [packages/worker/src/reservation-expiry.test.ts](../../../packages/worker/src/reservation-expiry.test.ts)
- [tests/integration/booking-concurrency.test.ts](../../../tests/integration/booking-concurrency.test.ts)

**Пробелы:**

- Нужно проверить точное соответствие 72-часовому требованию source.

## Telegram ingress and deterministic delivery

Есть webhook route, Telegram adapter и typed dispatcher outbox-доставки.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [apps/api/src/routes/telegram-webhook.ts](../../../apps/api/src/routes/telegram-webhook.ts)
- [packages/integrations/src/telegram/telegram-adapter.ts](../../../packages/integrations/src/telegram/telegram-adapter.ts)
- [packages/worker/src/telegram-send-text-dispatcher.ts](../../../packages/worker/src/telegram-send-text-dispatcher.ts)

**Существующие тесты:**

- [apps/api/src/routes/telegram-webhook.test.ts](../../../apps/api/src/routes/telegram-webhook.test.ts)
- [packages/integrations/src/telegram/telegram-adapter.test.ts](../../../packages/integrations/src/telegram/telegram-adapter.test.ts)
- [packages/worker/src/telegram-send-text-dispatcher.test.ts](../../../packages/worker/src/telegram-send-text-dispatcher.test.ts)

**Пробелы:**

- Рекламный promo_bot и source=promo_bot не подтверждены в просмотренных путях.

## Selarti boundary and fail-closed composition

Имеются порт, контрактный и disabled Selarti adapters, плюс response route.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/integrations/src/selarti/selarti-port.ts](../../../packages/integrations/src/selarti/selarti-port.ts)
- [packages/integrations/src/selarti/selarti-contract-adapter.ts](../../../packages/integrations/src/selarti/selarti-contract-adapter.ts)
- [packages/integrations/src/selarti/disabled-selarti-adapter.ts](../../../packages/integrations/src/selarti/disabled-selarti-adapter.ts)
- [apps/api/src/routes/selarti-response.ts](../../../apps/api/src/routes/selarti-response.ts)

**Существующие тесты:**

- [tests/contract/selarti-port.test.ts](../../../tests/contract/selarti-port.test.ts)
- [packages/application/src/selarti-response-service.test.ts](../../../packages/application/src/selarti-response-service.test.ts)
- [tests/integration/hybrid-message-gateway-b2.test.ts](../../../tests/integration/hybrid-message-gateway-b2.test.ts)

**Пробелы:**

- Сценарий из source с ценой/ручной верификацией не является доказанным активным Selarti-потоком.

## Consent and privacy authority

Есть domain consent, privacy service, repository и worker удаления.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/domain/src/consent.ts](../../../packages/domain/src/consent.ts)
- [packages/application/src/privacy-service.ts](../../../packages/application/src/privacy-service.ts)
- [packages/db/src/repositories/privacy-repository.ts](../../../packages/db/src/repositories/privacy-repository.ts)
- [packages/worker/src/privacy-erasure.ts](../../../packages/worker/src/privacy-erasure.ts)

**Существующие тесты:**

- [packages/domain/src/consent.test.ts](../../../packages/domain/src/consent.test.ts)
- [packages/application/src/privacy-service.test.ts](../../../packages/application/src/privacy-service.test.ts)
- [tests/integration/privacy-workflow.test.ts](../../../tests/integration/privacy-workflow.test.ts)

**Пробелы:**

- Политика source о 30-дневном ответе и полном перечне прав требует юридической/продуктовой сверки.

## Data retention

В коде и документации есть retention-процессы, включая B2-sensitive ветку.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/worker/src/data-retention.ts](../../../packages/worker/src/data-retention.ts)
- [packages/worker/src/b2-sensitive-retention.ts](../../../packages/worker/src/b2-sensitive-retention.ts)
- [docs/operations/data-retention.md](../../../docs/operations/data-retention.md)

**Существующие тесты:**

- [packages/worker/src/data-retention.test.ts](../../../packages/worker/src/data-retention.test.ts)
- [packages/worker/src/b2-sensitive-retention.test.ts](../../../packages/worker/src/b2-sensitive-retention.test.ts)
- [tests/integration/client-session-privacy.test.ts](../../../tests/integration/client-session-privacy.test.ts)

**Пробелы:**

- Сроки source для клиентов, резидентов, сайта и cookies не сопоставлены с существующей политикой.

## Outbox and idempotency

Есть durable outbox repository, runner, контракт и миграция.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/db/src/repositories/outbox-repository.ts](../../../packages/db/src/repositories/outbox-repository.ts)
- [packages/worker/src/outbox-runner.ts](../../../packages/worker/src/outbox-runner.ts)
- [packages/contracts/src/worker-outbox.ts](../../../packages/contracts/src/worker-outbox.ts)
- [packages/db/migrations/0004_durable_outbox.sql](../../../packages/db/migrations/0004_durable_outbox.sql)

**Существующие тесты:**

- [packages/db/src/repositories/outbox-repository.test.ts](../../../packages/db/src/repositories/outbox-repository.test.ts)
- [packages/worker/src/outbox-runner.test.ts](../../../packages/worker/src/outbox-runner.test.ts)
- [tests/integration/outbox-runner.test.ts](../../../tests/integration/outbox-runner.test.ts)

**Пробелы:**

- Новые source-сценарии должны использовать эти гарантии, но не могут обходить их прямыми внешними вызовами.

## Audit data

Есть audit schema и административный repository для экспертских рефералов.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/db/src/schema/audit.ts](../../../packages/db/src/schema/audit.ts)
- [packages/db/migrations/0014_admin_feedback_controls.sql](../../../packages/db/migrations/0014_admin_feedback_controls.sql)
- [packages/db/src/repositories/expert-referral-admin-repository.ts](../../../packages/db/src/repositories/expert-referral-admin-repository.ts)

**Существующие тесты:**

- [packages/db/src/repositories/expert-referral-admin-repository.test.ts](../../../packages/db/src/repositories/expert-referral-admin-repository.test.ts)
- [tests/repo/admin-ledger-prepared-sql-guard.test.ts](../../../tests/repo/admin-ledger-prepared-sql-guard.test.ts)

**Пробелы:**

- Аудит ручного approval/отклонения и payment-link из source требует отдельного контракта.

## Expert referrals

Существует отдельный экспертский реферальный bounded context с доменом, сервисом, repository и миграцией.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/application/src/expert-referral-service.ts](../../../packages/application/src/expert-referral-service.ts)
- [packages/db/src/repositories/expert-referral-repository.ts](../../../packages/db/src/repositories/expert-referral-repository.ts)
- [packages/domain/src/expert-referral.ts](../../../packages/domain/src/expert-referral.ts)
- [packages/db/migrations/0018_expert_residency_referrals.sql](../../../packages/db/migrations/0018_expert_residency_referrals.sql)

**Существующие тесты:**

- [packages/application/src/expert-referral-service.test.ts](../../../packages/application/src/expert-referral-service.test.ts)
- [packages/domain/src/expert-referral.test.ts](../../../packages/domain/src/expert-referral.test.ts)
- [tests/integration/expert-referral-redemption.test.ts](../../../tests/integration/expert-referral-redemption.test.ts)

**Пробелы:**

- Source 1000-бонусы и партнёрская атрибуция не следует отождествлять с текущим экспертским referral credit без решения владельца.

## Partner commerce

Есть миграция и integration test Partner Commerce A, а также утверждённый design-документ.

**Статус:** `partial`.

**Проверенные файлы:**

- [packages/db/migrations/0037_partner_commerce_a.sql](../../../packages/db/migrations/0037_partner_commerce_a.sql)
- [tests/integration/partner-commerce-a-migration.test.ts](../../../tests/integration/partner-commerce-a-migration.test.ts)
- [docs/superpowers/specs/2026-08-30-partner-commerce-and-acquisition-economics-design.md](../../../docs/superpowers/specs/2026-08-30-partner-commerce-and-acquisition-economics-design.md)

**Существующие тесты:**

- [tests/integration/partner-commerce-a-migration.test.ts](../../../tests/integration/partner-commerce-a-migration.test.ts)

**Пробелы:**

- Новые source-тарифы/пороги центров и организаторов конфликтуют с уже утверждёнными правилами и требуют reconciliation spec.

## Test-expert trial

Есть сервис, repository и миграция для отдельного trial «тест эксперт».

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/application/src/test-expert-telegram-service.ts](../../../packages/application/src/test-expert-telegram-service.ts)
- [packages/db/src/repositories/test-expert-telegram-repository.ts](../../../packages/db/src/repositories/test-expert-telegram-repository.ts)
- [packages/db/migrations/0038_test_expert_trial.sql](../../../packages/db/migrations/0038_test_expert_trial.sql)

**Существующие тесты:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../packages/application/src/test-expert-telegram-service.test.ts)
- [tests/repo/test-expert-trial-traceability.test.ts](../../../tests/repo/test-expert-trial-traceability.test.ts)

**Пробелы:**

- Source-подход 1000 бонусов/ручная квалификация не должен неявно менять лимитированный trial без отдельного решения.

## Runtime configuration and secret policy

Конфигурация и env-policy существуют; исходные секреты не должны попадать в tracked config.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [packages/config/src/env.ts](../../../packages/config/src/env.ts)
- [packages/config/src/env.test.ts](../../../packages/config/src/env.test.ts)
- [scripts/validate-runtime-env.sh](../../../scripts/validate-runtime-env.sh)
- [.env.example](../../../.env.example)

**Существующие тесты:**

- [packages/config/src/env.test.ts](../../../packages/config/src/env.test.ts)
- [tests/repo/env-policy.test.ts](../../../tests/repo/env-policy.test.ts)

**Пробелы:**

- Требуется redaction raw snapshot и безопасная ротация реальных учетных данных вне репозитория, если они действительны.

## Rate limiting and adult-only gate

Есть API rate-limit, но флаги MINOR_ONBOARDING_ENABLED/ALLOW_MINOR_DATA не подтверждены в просмотренных путях.

**Статус:** `partial`.

**Проверенные файлы:**

- [apps/api/src/rate-limit.ts](../../../apps/api/src/rate-limit.ts)
- [apps/api/src/rate-limit.test.ts](../../../apps/api/src/rate-limit.test.ts)
- [packages/config/src/env.ts](../../../packages/config/src/env.ts)

**Существующие тесты:**

- [apps/api/src/rate-limit.test.ts](../../../apps/api/src/rate-limit.test.ts)
- [tests/repo/env-policy.test.ts](../../../tests/repo/env-policy.test.ts)

**Пробелы:**

- Нужно отдельно определить compliant adult-only gate; source-инструкция удалить CI-проверки не подтверждает безопасную реализацию.

## Legal web content

В web-app есть legal content/view и текстовые оферта/политика.

**Статус:** `existing_needs_verification`.

**Проверенные файлы:**

- [apps/web/src/legal-content.ts](../../../apps/web/src/legal-content.ts)
- [apps/web/src/legal-view.ts](../../../apps/web/src/legal-view.ts)
- [apps/web/src/legal/oferta.txt](../../../apps/web/src/legal/oferta.txt)
- [apps/web/src/legal/policy.txt](../../../apps/web/src/legal/policy.txt)

**Существующие тесты:**

- [apps/web/src/legal-content.test.ts](../../../apps/web/src/legal-content.test.ts)
- [apps/web/src/legal-view.test.ts](../../../apps/web/src/legal-view.test.ts)

**Пробелы:**

- Новая оферта и privacy policy source требуют юридической проверки, redaction и отдельного diff against текущего текста.

## Observability and source attribution

Есть logger и метрики Selarti budget; promo_bot source attribution не найден в inspected paths.

**Статус:** `not_found_in_inspected_paths`.

**Проверенные файлы:**

- [packages/observability/src/logger.ts](../../../packages/observability/src/logger.ts)
- [packages/observability/src/selarti-budget-metrics.test.ts](../../../packages/observability/src/selarti-budget-metrics.test.ts)
- [apps/api/src/rate-limit.ts](../../../apps/api/src/rate-limit.ts)

**Существующие тесты:**

- [packages/observability/src/logger.test.ts](../../../packages/observability/src/logger.test.ts)
- [packages/observability/src/selarti-budget-metrics.test.ts](../../../packages/observability/src/selarti-budget-metrics.test.ts)

**Пробелы:**

- Нужен явный безопасный контур source=promo_bot с политикой retention и без влияния на финансовые права.
