# Owner decision: repeat reminder engagement

The owner approved the following replacement for the unavailable Telegram read
receipt signal on 30 October 2026 (Europe/Moscow): “Да, если не оплатил и не нажал”.

Repeat the reminder after three days only when the subscription remains unpaid
and the recipient has not pressed the payment button. Record engagement only from
an authenticated callback belonging to the current recipient/campaign. Do not
label this signal as message-read tracking. Recheck consent, verification,
payment status and cutoff immediately before each send, and suppress duplicate
initial or repeated deliveries through durable campaign identity.
