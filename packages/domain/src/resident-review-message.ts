export const residentTemplateBodies = {
  REJECT_NICHE_MISMATCH:
    "{NAME}, здравствуйте!\n\nМы внимательно изучили вашу заявку на участие в проекте ии-Тоня.\n\nНа данном этапе мы формируем базу специалистов, чья экспертиза и формат работы максимально точно соответствуют текущим запросам нашей аудитории и внутренним стандартам качества сервиса.\n\nК сожалению, ваше предложение пока не прошло этот фильтр. Это не оценка вашего профессионализма или ценности ваших услуг, а вопрос специфического совпадения с задачами платформы сейчас.\n\nМы сохранили ваши контакты в закрытом листе ожидания. Если наши критерии изменятся или появятся новые направления сотрудничества, мы свяжемся с вами первыми.\n\nЖелаем вам процветания в вашей практике! 🙏",
  REJECT_INSUFFICIENT_PROOF:
    "{NAME}, спасибо за интерес к проекту ии-Тоня.\n\nДля обеспечения безопасности и высокого уровня доверия наших клиентов мы предъявляем строгие требования к подтверждению квалификации резидентов.\n\nВ ходе проверки мы не смогли убедиться в достаточности предоставленных материалов (документов об образовании, активных кейсов или живого присутствия в социальных сетях), чтобы рекомендовать вас клиентам без рисков.\n\nЕсли вы решите дополнить свой портфель новыми сертификатами, опубликовать больше отзывов или активизировать ведение соцсетей — будем рады рассмотреть вашу повторную заявку через 1 месяц.\n\nУспехов в развитии вашего бренда! 💜",
  REJECT_LEGAL_VIOLATION:
    "{NAME}, здравствуйте.\n\nБлагодарим за обращение.\n\nПосле анализа вашей заявки мы вынуждены отказать в размещении. Проект ии-Тоня работает исключительно в сфере немедицинского саморазвития и оздоровления. Услуги, предполагающие медицинское вмешательство, диагностику заболеваний или гарантирование конкретных финансовых/карьерных результатов, выходят за рамки нашего регламента и требований законодательства РФ.\n\nЭто решение окончательное и связано с защитой интересов наших пользователей.\n\nРекомендуем искать площадки, специализирующиеся на вашем профиле.\n\nС уважением, команда ии-Тоня.",
  REQ_INFO_GENERIC:
    "{NAME}, ваша заявка принята в работу!\n\nЧтобы принять справедливое решение и предложить вам оптимальные условия участия, нам нужно уточнить пару моментов. Пожалуйста, ответьте на следующие вопросы:\n\n{QUESTIONS_LIST}\n\nТакже, если у вас есть дополнительные материалы (презентация, ссылка на подробный прайс, видео-знакомство), пришлите их сюда.\n\n⏳ Срок ответа: 48 часов. После этого мы продолжим проверку.\n\nСпасибо за сотрудничество! 🤝",
  REJECT_POST_PAYMENT_REFUND:
    "{NAME}, добрый день.\n\nМы завершили модерацию вашей карточки. К сожалению, выявлены существенные расхождения между заявленными данными и фактической деятельностью / требованиями безопасности проекта.\n\nВ связи с этим мы не можем продолжить сотрудничество и разместить вашу карточку в базе знаний.\n\nВозврат средств за онбординг осуществляется согласно оферте (в течение 10 рабочих дней на реквизиты, указанные при оплате).\n\nПриносим искренние извинения за доставленные неудобства. Данная мера необходима для поддержания высокого стандарта сервиса для наших клиентов.\n\nС уважением, руководитель отдела качества ии-Тоня.",
} as const;
export const residentTemplateKeys = Object.keys(
  residentTemplateBodies,
) as (keyof typeof residentTemplateBodies)[];
export type ResidentTemplateKey = keyof typeof residentTemplateBodies;
export type ResidentReviewAction =
  | "APPROVED_BASIC"
  | "APPROVED_EXCLUSIVE"
  | "REJECT_SOFT"
  | "REJECT_HARD"
  | "INFO_REQUESTED";
export interface ResidentMessageInput {
  key: ResidentTemplateKey | "APPROVED_BASIC" | "APPROVED_EXCLUSIVE";
  name?: string | null;
  questions?: string[];
  deadline?: string;
  reapplyAt?: string;
  tone?: "standard" | "warm" | "brief";
  editedText?: string;
}
const unsafe = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]|\{[A-Z_]+\}/u;
export function residentQuestions(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 10 ||
    value.some(
      (v) =>
        typeof v !== "string" || !v.trim() || v.length > 200 || unsafe.test(v),
    )
  )
    throw Error("resident_questions_invalid");
  return [...value] as string[];
}
/** Only the narrative greeting/closing may vary; fact-bearing sections are exact.
 * Arbitrary prose cannot be proved fact-free, so the editor offers bounded tone variants
 * and editable question details instead of accepting claims in an unrestricted suffix.
 */
export function renderResidentReviewMessage(input: ResidentMessageInput) {
  return renderMessage(input);
}

/** Wave terms must come from the immutable price snapshot, never manager input. */
export function renderWaveResidentReviewMessage(
  input: ResidentMessageInput,
  terms: { onboardingMinor: number; clientStart: string; prelaunch: boolean },
) {
  if (
    ![1000, 300000].includes(terms.onboardingMinor) ||
    !/^\d{1,2} [а-я]+ \d{4}$/u.test(terms.clientStart)
  )
    throw Error("resident_message_invalid");
  return renderMessage(input, terms);
}

function renderMessage(
  input: ResidentMessageInput,
  terms?: { onboardingMinor: number; clientStart: string; prelaunch: boolean },
) {
  if (input.key === "REJECT_POST_PAYMENT_REFUND")
    throw Error("resident_refund_policy_unavailable");
  if (input.name && (input.name.length > 120 || unsafe.test(input.name)))
    throw Error("resident_message_invalid");
  const greeting = input.name
    ? `${input.name}, здравствуйте!`
    : "Здравствуйте!";
  let body: string, action: ResidentReviewAction;
  if (input.key === "APPROVED_BASIC" || input.key === "APPROVED_EXCLUSIVE") {
    action = input.key;
    body =
      terms && !terms.prelaunch
        ? `Анкета одобрена. Категория: ${input.key === "APPROVED_BASIC" ? "Базовая" : "Эксклюзивная"}. Платформа открыта для клиентов. Актуальные условия участия доступны в /my_tariff.`
        : terms
          ? `Анкета одобрена. Категория: ${input.key === "APPROVED_BASIC" ? "Базовая" : "Эксклюзивная"}. Взнос за онбординг — ${terms.onboardingMinor / 100} ₽. Старт для клиентов — ${terms.clientStart} года. Вы можете оплатить онбординг и тариф одним платежом или оплатить только онбординг, а тариф по базовой цене — до старта. Выбранные условия доступны в /my_tariff. Постоянная цена и доступ к интервью открываются только после подтверждённой оплаты в срок.`
          : `Анкета одобрена. Категория: ${input.key === "APPROVED_BASIC" ? "Базовая" : "Эксклюзивная"}. Взнос за онбординг — 3000 ₽. Выбранные условия доступны в /my_tariff. Постоянная цена и доступ к интервью открываются только после подтверждённой оплаты в срок.`;
  } else {
    body = residentTemplateBodies[input.key].replace(
      /^\{NAME\},[^\n]*\n+/u,
      "",
    );
    action =
      input.key === "REQ_INFO_GENERIC"
        ? "INFO_REQUESTED"
        : input.key === "REJECT_LEGAL_VIOLATION"
          ? "REJECT_HARD"
          : "REJECT_SOFT";
    // No waitlist enrollment/consent source exists in this module.
    body = body.replace(/Мы сохранили ваши контакты[^\n]*\n*/u, "");
    if (action === "INFO_REQUESTED")
      body = body
        .replace(
          "{QUESTIONS_LIST}",
          residentQuestions(input.questions)
            .map((q, i) => `${i + 1}. ${q}`)
            .join("\n"),
        )
        .replace(
          "Срок ответа: 48 часов.",
          "Срок ответа — 48 часов с момента создания запроса. Точный срок и актуальные вопросы: /verification.",
        );
    if (action === "REJECT_SOFT")
      body +=
        "\n\nПовторная заявка доступна через 1 месяц с даты решения. Проверить возможность подачи: /reapply.";
    // A hard quality decision does not assert a legal violation or unknown blacklist fact.
    if (action === "REJECT_HARD")
      body =
        "Благодарим за обращение. После рассмотрения заявки мы вынуждены отказать в размещении: предложенный формат выходит за рамки действующего регламента проекта. Решение окончательное. Это сообщение не является обвинением в нарушении закона.\n\nС уважением, команда ии-Тоня.";
  }
  const tone = input.tone ?? "standard";
  if (!["standard", "warm", "brief"].includes(tone))
    throw Error("resident_message_invalid");
  const text = `${greeting}\n\n${body}${tone === "warm" ? "\n\nСпасибо за уделённое время." : tone === "brief" ? "\n\nКоманда ии-Тоня." : ""}`;
  if (
    text.length > 4096 ||
    new TextEncoder().encode(text).length > 12000 ||
    unsafe.test(text)
  )
    throw Error("resident_message_invalid");
  if (input.editedText !== undefined && input.editedText !== text)
    throw Error("resident_protected_message");
  return { text, action, templateVersion: 1 };
}
