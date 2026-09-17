---
title: "Client package catalog (DEC-FIN-002 / DEC-FIN-003)"
type: "policy"
created: "2026-09-17"
status: "blocked_on_owner_price"
task: "TASK-FIN-002"
live_activation: false
---

# Клиентский каталог пакетов

Зафиксировано решениями, **без выдуманных цен**.

## Решения

- DEC-FIN-002 ②: срок платных пакетов = **60 календарных дней**; intro «Знакомство» = **100** сообщений (текущая схема, без ретро-обрезки).
- DEC-FIN-003 ②: купоны при покупке = **только x2** от оплаты; `cash+credit=price`; фиксированные гранты 1000/2000/3000/4000 **не храним**.
- DEC-FIN-001 B: новые клиенты → будущая платная versioned policy, не `free_client_v2`.

## SKU (исполнимо частично)

| SKU | Units | Срок | Coupon grant | Price |
|---|---:|---|---|---|
| Знакомство (intro, current) | 100 | нет expiresAt | 0 | не продаётся; historical/current intro |
| Старт | 500 | 60д | x2(price) | **TBD owner** |
| Базовый | 1000 | 60д | x2(price) | **TBD owner** |
| Глубокий | 1500 | 60д | x2(price) | **TBD owner** |
| Максимальный | 2000 | 60д | x2(price) | **TBD owner** |

`expiresAt` платного SKU = `paid_at + 60 calendar days` в TZ, который закроет Q-169 (кандидат runtime `DISPLAY_TIMEZONE=Europe/Moscow`, **не утверждён этим документом**).

## Блокер продакшена

Абсолютных цен нет в источнике (файл 05). TASK-FIN-021 / включение `PAYMENTS_ENABLED` **запрещены**, пока owner не задаст price_minor каждого платного SKU. Q-169 остаётся открытым.
