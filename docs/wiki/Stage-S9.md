# S9 · Комплаенс РФ: персональные данные и платежи

Milestone: [9](https://github.com/Dimkox/ii-tonya-platform/milestone/9) · Label: `stage:compliance` · Статус: **В РАБОТЕ (#36 открыт)**

## Цель этапа

Зафиксировать требования 152-ФЗ/платёжного комплаенса как отдельный контур до включения live-платежей.

## Что вошло

- Blueprint по персональным данным и платежам РФ (PR #36, не смержен)
- Требования к согласиям, хранению и отзыву; границы minor-onboarding (MINOR_ONBOARDING_ENABLED=false)
- RAW_CONVERSATION_LOGGING=true запрещён броском исключения

## Документация-источник (main)

- [`docs/contracts/provider-activation.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/contracts/provider-activation.md)
- [`docs/security/threat-model-and-go-live-gates.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/security/threat-model-and-go-live-gates.md)
- [`docs/spec/normalized-requirements.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/normalized-requirements.md)

## PR этапа

[#36](https://github.com/Dimkox/ii-tonya-platform/pull/36)

## Гейты и ограничения

Retention/legal/minor-data approval в go-live-таблице = blocked, owner Privacy, reviewer unassigned.

**Статус этапа:** В РАБОТЕ (#36 открыт) · **Ключ этапа:** `S9` · **Label:** `stage:compliance`

## Открытые вопросы этапа

[#61](https://github.com/Dimkox/ii-tonya-platform/issues/61)

## PR этапа

[#36](https://github.com/Dimkox/ii-tonya-platform/pull/36)

## Открытые issues этапа

[#61](https://github.com/Dimkox/ii-tonya-platform/issues/61)

← [все этапы](Stages.md) · [Home](Home.md)
