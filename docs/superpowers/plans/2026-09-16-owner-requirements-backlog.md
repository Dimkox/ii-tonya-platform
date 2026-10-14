# Обновление требований ии-Тони — план исполнения

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Закрывать связанные решения до изменения поведения.

**Goal:** Исполнить согласованные пункты пяти файлов владельца без дублей и без потери исходных условий.

**Architecture:** Изменять существующий pnpm-монорепозиторий по вертикальным задачам, сохраняя PostgreSQL authority и версионирование коммерческих правил. Интеграции, правовые тексты и дизайн имеют самостоятельную приёмку.

**Tech Stack:** Node 24, pnpm 11.9.0, TypeScript, PostgreSQL; production native, Claw — тесты.

**Spec:** [SPEC.md](../../../_bmad-output/specs/spec-owner-update-2026-09-16/SPEC.md).

## Global Constraints

Прочитать [контракт исполнения](../../../_bmad-output/specs/spec-owner-update-2026-09-16/execution-contract.md) и AGENTS.md. Эта поставка создаёт 84 задач; не утверждает выполнение реализации. Порядок строк файлов не задаёт приоритет версии; 05 — дополнение, спорные пункты решает владелец. Денежные изменения не переписывают исторические policy snapshots.

## Начало работы

```bash
cd /home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/owner-spec-2026-09-16
git status --short --branch
git remote get-url origin
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```

Сначала выбрать открытое решение `TASK-DEC-*` или независимую ready-задачу. Дальше использовать зависимости из таблицы и точные item_ids карточки. Каждая карточка содержит файлы, собственные критерии, вопросы и будущие команды проверки.

## Очередь

| Задача | Результат | Тип / owner | Readiness | Зависимости / решения |
|---|---|---|---|---|
| [TASK-FIN-001](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-001.md) | Зафиксировать policy и когорты клиентского доступа | decision / product-owner | ready | DEC-FIN-001 |
| [TASK-FIN-002](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-002.md) | Специфицировать каталог и срок пакетов | decision / product-owner | pending_dependencies | TASK-FIN-001, DEC-FIN-002, DEC-FIN-003 |
| [TASK-FIN-003](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-003.md) | Спроектировать пакетный ledger и списание сообщений | design / backend | blocked_by_decision | TASK-FIN-001, TASK-FIN-002, DEC-FIN-001, DEC-FIN-002, DEC-FIN-003 |
| [TASK-FIN-004](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-004.md) | Специфицировать reminder истечения | decision / product-owner | pending_dependencies | TASK-FIN-002, DEC-FIN-004 |
| [TASK-FIN-005](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-005.md) | Специфицировать клиентский coupon ledger | design / backend | blocked_by_decision | TASK-FIN-002, TASK-DEC-FIN-005, TASK-DEC-FIN-006, TASK-DEC-FIN-026, TASK-DEC-FIN-027, DEC-FIN-005, DEC-FIN-006, DEC-FIN-026, DEC-FIN-027 |
| [TASK-FIN-006](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-006.md) | Изолировать test-expert финансовую демонстрацию | design / backend | blocked_by_decision | TASK-FIN-005, TASK-DEC-FIN-005, TASK-DEC-FIN-006, DEC-FIN-005, DEC-FIN-006 |
| [TASK-FIN-007](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-007.md) | Выбрать новую expert pricing policy | decision / product-owner | ready | DEC-FIN-007, DEC-FIN-009 |
| [TASK-FIN-008](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-008.md) | Спроектировать personal expert quote | design / backend | blocked_by_decision | TASK-FIN-007, TASK-DEC-FIN-021, TASK-DEC-FIN-024, TASK-FIN-009, DEC-FIN-007, DEC-FIN-021, DEC-FIN-024, DEC-FIN-028 |
| [TASK-FIN-009](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-009.md) | Утвердить city и low-check классификаторы | decision / product-owner | pending_dependencies | TASK-FIN-007, DEC-FIN-007, DEC-FIN-023, DEC-FIN-028 |
| [TASK-FIN-010](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-010.md) | Выбрать и специфицировать Energy Start | decision / product-owner | pending_dependencies | TASK-FIN-007, DEC-FIN-010, DEC-FIN-011 |
| [TASK-FIN-011](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-011.md) | Спроектировать Start/floor/2-for-1 порядок | design / backend | blocked_by_decision | TASK-FIN-010, DEC-FIN-011 |
| [TASK-FIN-012](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-012.md) | Выбрать centre tier и referral qualification | decision / product-owner | ready | DEC-FIN-012 |
| [TASK-FIN-013](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-013.md) | Выбрать organizer tier и consumption rules | decision / product-owner | ready | DEC-FIN-012 |
| [TASK-FIN-014](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-014.md) | Специфицировать group-event financial settlement | decision / product-owner | ready | DEC-FIN-013, DEC-FIN-020 |
| [TASK-FIN-015](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-015.md) | Выбрать lifecycle экспертского referral code | decision / product-owner | ready | DEC-FIN-014, DEC-FIN-022 |
| [TASK-FIN-016](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-016.md) | Специфицировать qualification и reversal referral reward | design / backend | blocked_by_decision | TASK-FIN-015, TASK-DEC-FIN-015, DEC-FIN-015 |
| [TASK-FIN-017](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-017.md) | Специфицировать bonus ledger и годовой expiry | design / backend | blocked_by_decision | TASK-FIN-016, TASK-DEC-FIN-018, DEC-FIN-018 |
| [TASK-FIN-018](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-018.md) | Расширить versioned bonus cap по категориям | design / backend | blocked_by_decision | TASK-FIN-007, TASK-FIN-012, TASK-FIN-013, TASK-DEC-FIN-017, DEC-FIN-017 |
| [TASK-FIN-019](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-019.md) | Выбрать promo maturity for bonus spend | decision / product-owner | pending_dependencies | TASK-FIN-010, DEC-FIN-016 |
| [TASK-FIN-020](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-020.md) | Подготовить versioned finance migration plan | design / backend | blocked_by_decision | TASK-FIN-002, TASK-FIN-005, TASK-FIN-008, TASK-FIN-010, TASK-FIN-017, TASK-FIN-018, TASK-FIN-019, TASK-FIN-001, TASK-DEC-FIN-005, TASK-FIN-007, TASK-DEC-FIN-017, DEC-FIN-001, DEC-FIN-002, DEC-FIN-005, DEC-FIN-007, DEC-FIN-010, DEC-FIN-011, DEC-FIN-016, DEC-FIN-017 |
| [TASK-FIN-021](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-021.md) | Реализовать approved client policy only after decisions | implementation / backend | blocked_by_decision | TASK-FIN-003, TASK-FIN-004, TASK-FIN-005, TASK-FIN-020, TASK-FIN-001, TASK-FIN-002, TASK-DEC-FIN-005, TASK-DEC-FIN-006, TASK-DEC-FIN-019, TASK-DEC-FIN-026, DEC-FIN-001, DEC-FIN-002, DEC-FIN-003, DEC-FIN-004, DEC-FIN-005, DEC-FIN-006, DEC-FIN-019, DEC-FIN-026 |
| [TASK-FIN-022](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-022.md) | Реализовать approved personal pricing and Energy Start | implementation / backend | blocked_by_decision | TASK-FIN-008, TASK-FIN-009, TASK-FIN-010, TASK-FIN-011, TASK-FIN-020, TASK-FIN-007, TASK-DEC-FIN-021, TASK-DEC-FIN-024, DEC-FIN-007, DEC-FIN-009, DEC-FIN-010, DEC-FIN-011, DEC-FIN-021, DEC-FIN-023, DEC-FIN-024, DEC-FIN-028 |
| [TASK-FIN-023](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-023.md) | Реализовать approved partner finance policy | implementation / backend | blocked_by_decision | TASK-FIN-012, TASK-FIN-013, TASK-FIN-014, TASK-FIN-020, DEC-FIN-012, DEC-FIN-013, DEC-FIN-020 |
| [TASK-FIN-024](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-024.md) | Реализовать approved expert referral and bonus policy | implementation / backend | blocked_by_decision | TASK-FIN-015, TASK-FIN-016, TASK-FIN-017, TASK-FIN-018, TASK-FIN-019, TASK-FIN-020, TASK-DEC-FIN-015, TASK-DEC-FIN-017, TASK-DEC-FIN-018, DEC-FIN-014, DEC-FIN-015, DEC-FIN-016, DEC-FIN-017, DEC-FIN-018 |
| [TASK-FIN-025](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-FIN-025.md) | Проверить active financial content against selected policy | content / product-owner | blocked_by_decision | TASK-FIN-021, TASK-FIN-022, TASK-FIN-024, TASK-DEC-FIN-005, TASK-FIN-007, TASK-DEC-FIN-008, TASK-FIN-015, TASK-DEC-FIN-027, DEC-FIN-005, DEC-FIN-007, DEC-FIN-008, DEC-FIN-014, DEC-FIN-022, DEC-FIN-027 |
| [TASK-EXP-001](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-001.md) | Ограничитель клиентской копии ии-Тони | content / product-owner | ready | — |
| [TASK-EXP-002](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-002.md) | Таксономия и правила подбора клиента | implementation / backend | pending_dependencies | TASK-EXP-001, TASK-PLT-008 |
| [TASK-EXP-003](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-003.md) | Политика сопровождения клиента после визита | implementation / backend | blocked_by_decision | TASK-EXP-002, TASK-FIN-021, TASK-PLT-008, TASK-DEC-EXP-006, DEC-EXP-006 |
| [TASK-EXP-004](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-004.md) | КлиентскийFAQ, аудиокаст и уведомления по утверждённой policy | implementation / backend | blocked_by_decision | TASK-FIN-001, TASK-FIN-002, TASK-FIN-003, TASK-FIN-004, TASK-FIN-021, TASK-PLT-004, DEC-FIN-001, DEC-FIN-002, DEC-FIN-003, DEC-FIN-004 |
| [TASK-EXP-006](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-006.md) | Telegram-команды эксперта для броней | implementation / backend | blocked_by_decision | TASK-PLT-003, TASK-PLT-008, TASK-FIN-021, TASK-PLT-002, TASK-DEC-PLT-004, DEC-PLT-004 |
| [TASK-EXP-007](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-007.md) | Вход и состояния теста эксперта | implementation / backend | pending_dependencies | TASK-EXP-001 |
| [TASK-EXP-008](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-008.md) | Демо-диагностика и карточки эксперта | implementation / backend | pending_dependencies | TASK-EXP-007, TASK-FIN-006 |
| [TASK-EXP-009](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-009.md) | Продажный диалог эксперта и handoff | implementation / backend | pending_dependencies | TASK-EXP-007 |
| [TASK-EXP-010](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-010.md) | Статусная машина онбординга резидента | implementation / backend | blocked_by_decision | TASK-EXP-009, TASK-FIN-022, TASK-PLT-008, TASK-DEC-PLT-006, TASK-DEC-FIN-026, DEC-PLT-006, DEC-FIN-026 |
| [TASK-EXP-011](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-011.md) | Пауза резидента и проекции entitlements | implementation / backend | blocked_by_decision | TASK-EXP-010, TASK-PLT-009, TASK-FIN-022, TASK-FIN-012, TASK-FIN-014, TASK-DEC-PLT-004, DEC-FIN-012, DEC-FIN-020, DEC-PLT-004 |
| [TASK-EXP-012](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-012.md) | Проекция политики доплаты за мероприятия | integration / backend | blocked_by_decision | TASK-EXP-010, TASK-FIN-023, TASK-FIN-012, TASK-FIN-014, DEC-FIN-012, DEC-FIN-020 |
| [TASK-EXP-013](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-013.md) | Структура и copy лендинга | content / product-owner | pending_dependencies | TASK-EXP-001 |
| [TASK-EXP-014](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-014.md) | Визуальная система лендинга | design / designer | blocked_by_decision | TASK-EXP-013, TASK-DEC-EXP-005, DEC-EXP-005 |
| [TASK-EXP-015](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-015.md) | Коммерческая копия лендинга из policy | integration / backend | blocked_by_decision | TASK-EXP-004, TASK-EXP-012, TASK-FIN-025, TASK-FIN-001, TASK-FIN-002, TASK-FIN-004, TASK-FIN-012, TASK-FIN-014, TASK-FIN-010, TASK-FIN-019, TASK-DEC-FIN-017, DEC-FIN-001, DEC-FIN-002, DEC-FIN-003, DEC-FIN-004, DEC-FIN-012, DEC-FIN-020, DEC-FIN-010, DEC-FIN-011, DEC-FIN-016, DEC-FIN-017 |
| [TASK-EXP-016](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-016.md) | Ledger слотов пространств | implementation / backend | blocked_by_decision | TASK-EXP-010, TASK-FIN-023, TASK-PLT-001, TASK-FIN-012, TASK-FIN-014, DEC-FIN-012, DEC-FIN-020 |
| [TASK-EXP-017](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-017.md) | Рендер акции пространств из policy | content / product-owner | blocked_by_decision | TASK-EXP-015, TASK-FIN-022, TASK-FIN-023, TASK-FIN-010, TASK-FIN-019, TASK-DEC-FIN-017, DEC-FIN-010, DEC-FIN-011, DEC-FIN-016, DEC-FIN-017 |
| [TASK-EXP-018](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-018.md) | Тексты«Энергии начала» по согласованному расчёту | content / product-owner | blocked_by_decision | TASK-FIN-001, TASK-FIN-002, TASK-FIN-003, TASK-FIN-004, TASK-EXP-015, TASK-FIN-022, TASK-FIN-024, TASK-FIN-010, TASK-FIN-019, TASK-DEC-FIN-017, DEC-FIN-001, DEC-FIN-002, DEC-FIN-003, DEC-FIN-004, DEC-FIN-010, DEC-FIN-011, DEC-FIN-016, DEC-FIN-017 |
| [TASK-EXP-019](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-019.md) | Логотип, персонаж и восемь поз | design / designer | ready | — |
| [TASK-EXP-020](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-020.md) | Локальный бриф визуального языка | design / designer | blocked_by_decision | TASK-EXP-019, TASK-DEC-EXP-005, DEC-EXP-005 |
| [TASK-EXP-021](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-EXP-021.md) | Брендбук и полный пакет файлов для использования | design / designer | pending_dependencies | TASK-EXP-019, TASK-EXP-020 |
| [TASK-PLT-001](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-001.md) | Резервирование, лимит мест и границы24/72ч | implementation / backend | blocked_by_decision | TASK-FIN-021, TASK-PLT-008, TASK-DEC-PLT-001, DEC-PLT-001 |
| [TASK-PLT-002](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-002.md) | Истечение резерва и продвижение очереди | implementation / backend | blocked_by_decision | TASK-PLT-001, TASK-DEC-PLT-001, DEC-PLT-001 |
| [TASK-PLT-003](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-003.md) | Подтверждение, отмена и перенос из Telegram | implementation / backend | pending_dependencies | TASK-PLT-001, TASK-PLT-004, TASK-PLT-008 |
| [TASK-PLT-004](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-004.md) | Адаптер Planerka и восстановление проекции брони | integration / backend | blocked_by_decision | TASK-PLT-008, TASK-PLT-013, TASK-DEC-PLT-003, TASK-DEC-PLT-004, DEC-PLT-003, DEC-PLT-004 |
| [TASK-PLT-005](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-005.md) | Selarti, Make и Sheets как интеграции backend | integration / backend | blocked_by_decision | TASK-FIN-021, TASK-PLT-008, TASK-PLT-013, TASK-DEC-PLT-003, TASK-DEC-PLT-004, DEC-PLT-003, DEC-PLT-004 |
| [TASK-PLT-006](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-006.md) | Встреча с менеджером и демонстрационный календарь | implementation / backend | blocked_by_decision | TASK-PLT-004, TASK-EXP-008, TASK-PLT-008, TASK-PLT-013, TASK-DEC-PLT-002, TASK-DEC-PLT-004, DEC-PLT-002, DEC-PLT-004 |
| [TASK-PLT-007](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-007.md) | Анкета, проверка менеджера и подтверждённая передача | integration / backend | blocked_by_decision | TASK-EXP-010, TASK-PLT-008, TASK-DEC-PLT-006, TASK-DEC-PLT-004, DEC-PLT-006, DEC-PLT-004 |
| [TASK-PLT-008](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-008.md) | Согласия, минимизация и доступ к профилям | implementation / backend | blocked_by_decision | TASK-DEC-PLT-004, DEC-PLT-004 |
| [TASK-PLT-009](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-009.md) | Доступ, исправление, отзыв, удаление и сроки хранения | implementation / backend | blocked_by_decision | TASK-PLT-008, TASK-DEC-PLT-005, DEC-PLT-005 |
| [TASK-PLT-010](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-010.md) | Отзывы, негативные обращения и приватные алерты | implementation / backend | blocked_by_decision | TASK-PLT-008, TASK-DEC-PLT-004, DEC-PLT-004 |
| [TASK-PLT-011](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-011.md) | Согласовать и реализовать18+ и кризисный handoff | implementation / backend | blocked_by_decision | TASK-PLT-008, TASK-FIN-021, TASK-DEC-PLT-008, TASK-DEC-PLT-007, DEC-PLT-008, DEC-PLT-007 |
| [TASK-PLT-012](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-012.md) | Единая оферта, политика и уведомления об изменениях | content / legal | blocked_by_decision | TASK-FIN-025, TASK-PLT-008, TASK-PLT-009, TASK-EXP-011, TASK-DEC-PLT-007, TASK-DEC-PLT-004, TASK-DEC-PLT-005, DEC-PLT-007, DEC-PLT-004, DEC-PLT-005 |
| [TASK-PLT-013](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-013.md) | Конфигурация, секреты и журнал интеграций | verification / ops | ready | — |
| [TASK-PLT-014](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-014.md) | Атрибуция рекламного бота и партнёров | implementation / backend | blocked_by_decision | TASK-FIN-024, TASK-DEC-PLT-009, DEC-PLT-009 |
| [TASK-PLT-015](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-015.md) | Карта поставки, проверка сценариев и будущий выпуск | verification / qa | blocked_by_decision | TASK-PLT-002, TASK-PLT-003, TASK-PLT-005, TASK-PLT-010, TASK-PLT-011, TASK-PLT-012, TASK-PLT-014, TASK-EXP-021, TASK-PLT-004, TASK-PLT-006, TASK-PLT-007, TASK-PLT-016, TASK-DEC-PLT-010, DEC-PLT-010 |
| [TASK-PLT-016](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-PLT-016.md) | Персонализация профиля и новые предложения | implementation / backend | blocked_by_decision | TASK-EXP-002, TASK-EXP-003, TASK-PLT-008, TASK-DEC-PLT-004, DEC-PLT-004 |
| [TASK-DEC-FIN-005](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-005.md) | Решить: Срок и частичный cap клиентских купонов | decision / product-owner | ready | — |
| [TASK-DEC-FIN-006](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-006.md) | Решить: Возвраты клиентской купонной оплаты | decision / product-owner | ready | — |
| [TASK-DEC-FIN-008](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-008.md) | Решить: Статус legacy weekly и Early Birds | decision / product-owner | ready | — |
| [TASK-DEC-FIN-015](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-015.md) | Решить: Квалификация экспертской реферальной награды | decision / product-owner | ready | — |
| [TASK-DEC-FIN-017](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-017.md) | Решить: Bonus spend cap и база расчёта | decision / product-owner | ready | — |
| [TASK-DEC-FIN-018](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-018.md) | Решить: Временная семантика годового бонуса | decision / product-owner | ready | — |
| [TASK-DEC-FIN-019](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-019.md) | Решить: Клиентский referral anti-fraud | decision / product-owner | ready | — |
| [TASK-DEC-FIN-021](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-021.md) | Решить: Точный renewal cadence | decision / product-owner | ready | — |
| [TASK-DEC-FIN-024](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-024.md) | Решить: Проверка данных и пересчёт цены | decision / product-owner | ready | — |
| [TASK-DEC-FIN-026](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-026.md) | Решить: Payment provider and uncertain outcome | decision / product-owner | ready | — |
| [TASK-DEC-FIN-027](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-FIN-027.md) | Решить: Контент компенсации expert coupon | decision / product-owner | ready | — |
| [TASK-DEC-EXP-005](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-EXP-005.md) | Решить: Palette selection | decision / product-owner | ready | — |
| [TASK-DEC-EXP-006](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-EXP-006.md) | Решить: Порядок отзыва, паузы и ежедневных чекапов | decision / product-owner | ready | — |
| [TASK-DEC-PLT-001](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-PLT-001.md) | Решить: Временные границы брони и очереди | decision / product-owner | ready | — |
| [TASK-DEC-PLT-002](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-PLT-002.md) | Решить: Календарь менеджера и демо | decision / product-owner | ready | — |
| [TASK-DEC-PLT-003](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-PLT-003.md) | Решить: Контракты внешних провайдеров | decision / product-owner | ready | — |
| [TASK-DEC-PLT-004](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-PLT-004.md) | Решить: Основания, профиль и получатели данных | decision / product-owner | ready | — |
| [TASK-DEC-PLT-005](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-PLT-005.md) | Решить: Сроки хранения и ответы субъектам | decision / product-owner | ready | — |
| [TASK-DEC-PLT-006](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-PLT-006.md) | Решить: SLA публикации и начало оплаченного периода | decision / product-owner | ready | — |
| [TASK-DEC-PLT-007](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-PLT-007.md) | Решить: Юридическая редакция, каналы и уведомления | decision / product-owner | ready | — |
| [TASK-DEC-PLT-008](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-PLT-008.md) | Решить: Проверка18+ и кризисные контакты | decision / product-owner | ready | — |
| [TASK-DEC-PLT-009](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-PLT-009.md) | Решить: Атрибуция нескольких каналов | decision / product-owner | ready | — |
| [TASK-DEC-PLT-010](../../../_bmad-output/specs/spec-owner-update-2026-09-16/tasks/TASK-DEC-PLT-010.md) | Решить: ГраницаMVP и график материалов | decision / product-owner | ready | — |

## Проверка полноты

[Реестр по пунктам](../../../_bmad-output/specs/spec-owner-update-2026-09-16/requirements.md), [источники](../../../_bmad-output/specs/spec-owner-update-2026-09-16/source-register.md), [решения](../../../_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md).
