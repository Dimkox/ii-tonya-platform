import { createHash } from "node:crypto";
import {
  residentForm,
  residentRoles,
  type ResidentDocument,
  type ResidentDraft,
  type ResidentPolicy,
  residentPolicy,
  residentPolicyV2,
  residentDocumentFields,
  type ResidentField,
} from "@ii-tonya/domain";
import type {
  ExpertApplicantScope,
  ExpertApplicantReply,
} from "./expert-applicant-service.js";
export interface ResidentFormSnapshot {
  formVersion?: 1 | 2;
  activeRequestId?: string | null;
  informationRequest?: {
    id: string;
    questions: string[];
    deadline: string;
    remainingSeconds: number;
  } | null;
  currentField?: ResidentField | null;
  policyVersion?: string;
  educationRequirement?: ResidentPolicy["education"];
  id: string;
  revision: number;
  draft: ResidentDraft;
  status: string;
  progress: string;
  replay: boolean;
}
export interface ResidentFormRepository {
  mutate(
    input: ExpertApplicantScope & {
      requestKey: string;
      requestDigest: string;
      action:
        | "start"
        | "patch"
        | "submit"
        | "followup"
        | "question"
        | "complete"
        | "reapply";
      expectedRevision?: number;
      applicationId?: string;
      patch?: unknown;
      requestId?: string;
      questionNumber?: number;
      answer?: string;
      documents?: ResidentDocument[];
      field?: ResidentField;
    },
  ): Promise<ResidentFormSnapshot>;
}
export type ResidentFormInput = ExpertApplicantScope & {
  updateId: number;
  text: string;
  callbackData?: string;
  firstName?: string;
  media?: ResidentDocument;
};
const roleLabels = {
  EXPERT: "Эксперт",
  CENTER: "Центр / помещение",
  ORGANIZER: "Организатор",
  EDU_PROJECT: "Образовательный проект",
  ESOTERIC: "Эзотерическая практика",
  OTHER: "Другая роль",
} as const;
const taxLabels = {
  SELF_EMPLOYED: "Самозанятый",
  IP: "ИП",
  LLC: "ООО",
  INDIVIDUAL: "Физическое лицо",
  INDIVIDUAL_NO_STATUS: "Физлицо без статуса",
} as const;
const categoryLabels = {
  BASIC: "Базовая",
  EXCLUSIVE: "Эксклюзивная",
  BOTH: "Обе категории",
} as const;
const labels: Record<ResidentField, string> = {
  roles: "Выберите все роли и нажмите «Далее».",
  primaryRole: "Выберите основную роль.",
  category:
    "Выберите категорию. Критерии категорий готовятся; выбор не означает допуск.",
  tax: "Укажите налоговый статус. Это помогает оценить масштаб бизнеса. Отсутствие ИП или самозанятости само по себе не является причиной отказа.",
  city: "В каком городе вы работаете?",
  socialLinks:
    "Пришлите ссылки на ваши публичные страницы через пробел (https://). Мы пока не проверяем страницы автоматически.",
  motivation: "Почему вы хотите стать резидентом?",
  specialization: "Укажите специализацию.",
  averageCheckMinor:
    "Укажите средний чек в рублях (например, 15000 или 15000,50). Это информация для проверки, не цена участия.",
  education:
    "Пришлите диплом или иной документ об образовании: PDF/JPEG/PNG до 20 МБ. Для вашей ниши правила пока неизвестны; проверит менеджер.",
  propertyEvidence:
    "Пришлите документ о праве пользования помещением: PDF/JPEG/PNG до 20 МБ.",
  capacity:
    "Сколько человек вмещает помещение? Укажите положительное целое число.",
  amenities: "Выберите удобства или перечислите их текстом через запятую.",
  path: "Расскажите о вашем профессиональном пути.",
  cases: "Опишите примеры результатов работы с клиентами.",
  methods: "Какие методы вы используете?",
  experienceYears: "Сколько лет опыта? Укажите целое число от 0 до 100.",
  premisesType: "Какой тип помещения?",
  tourMedia: "Пришлите фото или видео тура: JPEG/PNG/MP4 до 20 МБ.",
  eventFormat: "Опишите формат мероприятий.",
  programme: "Опишите программу.",
  speakers: "Расскажите о спикерах.",
  pastEvents:
    "Опишите прошлые мероприятия и укажите ссылки на фото, видео или отзывы.",
  projectName: "Название школы или курса?",
  licence:
    "Если есть, пришлите лицензию или аккредитацию: PDF/DOCX/JPEG/PNG до 20 МБ.",
  teachingTeam: "Расскажите о преподавателях.",
  graduateReviews: "Приведите отзывы выпускников или ссылки на них.",
};
const fieldCodes: Record<string, ResidentField> = {
  r: "roles",
  p: "primaryRole",
  c: "category",
  t: "tax",
  y: "city",
  s: "socialLinks",
  m: "motivation",
  z: "specialization",
  v: "averageCheckMinor",
  d: "education",
  o: "propertyEvidence",
  n: "capacity",
  a: "amenities",
  h: "path",
  k: "cases",
  me: "methods",
  ex: "experienceYears",
  pt: "premisesType",
  tm: "tourMedia",
  ef: "eventFormat",
  pr: "programme",
  sp: "speakers",
  pe: "pastEvents",
  pn: "projectName",
  li: "licence",
  tt: "teachingTeam",
  gr: "graduateReviews",
};
const fieldCode = (field: ResidentField) =>
  Object.entries(fieldCodes).find(([, v]) => v === field)![0];
const corrective = (
  text = "Ответ не подошёл. Сохранённые ответы не изменены. Отправьте /verification, чтобы продолжить, или /edit для исправления.",
): ExpertApplicantReply => ({
  status: "handled",
  text,
  replyMarkup: { remove_keyboard: true },
});
const policyChanged = (): ExpertApplicantReply =>
  corrective(
    "Ответы сохранены без изменений: правила анкеты изменились. Дальнейшее заполнение ожидает ручной проверки версии правил. Редактирование и отправка временно недоступны.",
  );
function rolePatch(
  draft: ResidentDraft,
  roles: NonNullable<ResidentDraft["roles"]>,
) {
  return {
    roles,
    ...(draft.primaryRole && !roles.includes(draft.primaryRole)
      ? { primaryRole: null }
      : {}),
  };
}
function applicantAverageCheck(minor: string): string {
  const amount = BigInt(minor);
  return `${(amount / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, " ")},${(amount % 100n).toString().padStart(2, "0")} ₽`;
}
function summary(draft: ResidentDraft): string {
  const short = (v: string | undefined, n = 120) =>
    (v ?? "—").replace(/\s+/gu, " ").slice(0, n);
  return [
    `Проверьте сохранённые ответы:`,
    `Роли: ${(draft.roles ?? []).map((r) => roleLabels[r]).join(", ")}. Основная: ${draft.primaryRole ? roleLabels[draft.primaryRole] : "—"}.`,
    `Категория: ${draft.category ? categoryLabels[draft.category] : "—"}. Налоговый статус: ${draft.tax ? taxLabels[draft.tax] : "—"}.`,
    `Город: ${short(draft.city)}. Ссылок: ${draft.socialLinks?.length ?? 0}.`,
    `Мотивация: ${short(draft.motivation, 160)}${(draft.motivation?.length ?? 0) > 160 ? "…" : ""}`,
    ...(draft.specialization
      ? [`Специализация: ${short(draft.specialization)}.`]
      : []),
    ...(draft.roles?.includes("EXPERT") && draft.averageCheckMinor !== undefined
      ? [
          `Ваш средний чек услуг: ${applicantAverageCheck(draft.averageCheckMinor)} (не цена подписки).`,
        ]
      : []),
    `Образование: ${draft.education?.length ?? 0}. Документы о помещении: ${draft.propertyEvidence?.length ?? 0}.`,
    ...(draft.capacity
      ? [
          `Вместимость: ${draft.capacity}. Удобств: ${draft.amenities?.length ?? 0}.`,
        ]
      : []),
  ].join("\n");
}
function renderForm(
  salesFirst: boolean,
  s: ResidentFormSnapshot,
  policy: ResidentPolicy,
  field: ResidentField | null = s.currentField ??
    residentForm(s.draft, policy, s.formVersion ?? 1).next,
  wavePaymentFlow = false,
): ExpertApplicantReply {
  if (s.status === "INFO_REQUESTED")
    return {
      status: "handled",
      text:
        (s.informationRequest
          ? `Запрос ${s.informationRequest.id}.\nВопросы:\n${s.informationRequest.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\nСрок: ${new Date(s.informationRequest.deadline).toLocaleString("ru-RU", { timeZone: "UTC" })} UTC. Осталось ${Math.max(0, Math.ceil(s.informationRequest.remainingSeconds / 60))} мин.\n`
          : "") +
        "Ответы сохранены отдельно от исходной анкеты. Пришлите ответы и дополнительные файлы. Для каждого ответа: /answer ID_ЗАПРОСА НОМЕР ВАШ_ОТВЕТ. Когда закончите: /answers_done ID_ЗАПРОСА. После срока заявка продолжит ручную проверку.",
    };
  if (s.status === "REJECTED")
    return {
      status: "handled",
      text: "По анкете принято решение. Для проверки возможности новой заявки отправьте /reapply. История и оплаченные условия сохраняются.",
    };
  if (s.status !== "PENDING_DOCS")
    return {
      status: "handled",
      replyMarkup: salesFirst
        ? {
            inline_keyboard: [
              [{ text: "Мой актуальный тариф", callback_data: "st:current" }],
            ],
          }
        : { remove_keyboard: true },
      text: salesFirst
        ? wavePaymentFlow
          ? "Анкета получена. Выбранный способ оплаты сохранён. После одобрения откройте /my_tariff и получите счёт по выбранным условиям: при оплате сразу это единый счёт за онбординг и тариф, при выборе «позже» — только онбординг. Если адрес электронного чека ещё не указан, бот попросит его перед оплатой. Дополнения можно прислать ответным сообщением."
          : "Анкета получена. Выбранные условия доступны в /my_tariff. Менеджер проверит анкету; после одобрения отдельно выставляется взнос за онбординг 3000 ₽. Для электронного чека отправьте /receipt и ваш email. Дополнения можно прислать ответным сообщением."
        : "Анкета получена. Дополнения можно прислать ответным сообщением. Автоматические проверки и загрузка документов ожидают обработки; результаты пока не подтверждены. Решение менеджера и цены ещё не доступны.",
    };
  const callback = (action: string) => `rv:${s.id}:${s.revision}:${action}`;
  const button = (text: string, action: string) => ({
    text,
    callback_data: callback(action),
  });
  let keyboard: { text: string; callback_data: string }[][] = [];
  if (field === "roles")
    keyboard = [
      ...residentRoles.map((r) => [
        button(
          `${s.draft.roles?.includes(r) ? "✓ " : ""}${roleLabels[r]}`,
          `r:${r}`,
        ),
      ]),
      [button("Далее", "next")],
    ];
  if (field === "primaryRole")
    keyboard = (s.draft.roles ?? []).map((r) => [
      button(roleLabels[r], `p:${r}`),
    ]);
  if (field === "category")
    keyboard = [
      ...(["BASIC", "EXCLUSIVE", "BOTH"] as const).map((v) => [
        button(categoryLabels[v], `c:${v}`),
      ]),
      [button("Изменить роли", "roles")],
    ];
  if (field === "tax")
    keyboard = (
      s.formVersion === 2
        ? (["SELF_EMPLOYED", "IP", "LLC", "INDIVIDUAL_NO_STATUS"] as const)
        : (["SELF_EMPLOYED", "IP", "LLC", "INDIVIDUAL"] as const)
    ).map((v, i) => [button(taxLabels[v], `t:${["s", "i", "l", "n"][i]}`)]);
  if (field === "amenities")
    keyboard = [
      [button("Wi-Fi", "a:wifi"), button("Парковка", "a:parking")],
      [button("Оборудование", "a:equipment"), button("Другое", "a:other")],
      [button("Нет перечисленных", "a:none")],
      [button("Далее", "next")],
    ];
  if (
    field &&
    residentDocumentFields.includes(
      field as (typeof residentDocumentFields)[number],
    )
  ) {
    const code = fieldCode(field),
      docs = (s.draft[field] ?? []) as ResidentDocument[];
    keyboard = [
      ...docs.map((_, i) => [
        button(`Удалить документ ${i + 1}`, `rm:${code}_${i}`),
      ]),
      ...(docs.length
        ? [
            [
              button("Очистить документы", `clear:${code}`),
              button("Заменить документы", `replace:${code}`),
            ],
          ]
        : []),
      ...((field === "education" || field === "licence") &&
      !residentForm(s.draft, policy, s.formVersion ?? 1).required.includes(
        "education",
      )
        ? [[button("Пропустить / назад", "back")]]
        : []),
      ...(docs.length ? [[button("Далее", "next")]] : []),
    ];
  }
  if (!field)
    keyboard = [
      [button("Отправить анкету", "submit")],
      [button("Исправить ответы", "edit")],
      ...(s.draft.roles?.includes("EXPERT")
        ? [[button("Добавить образование", "e:d")]]
        : []),
    ];
  if (salesFirst)
    keyboard.push([
      { text: "Мой актуальный тариф", callback_data: "st:current" },
    ]);
  return {
    status: "handled",
    text: field
      ? `${field === "education" && s.formVersion === 2 ? "Образование необязательно. При желании пришлите PDF/DOCX/JPEG/PNG до 20 МБ или пропустите." : field === "education" && policy.education === "required" ? "Пришлите документ об образовании (PDF/JPEG/PNG до 20 МБ): это требование действующей версии анкеты, документ будет проверен отдельно." : labels[field]}\nАнкета сохранена (ревизия ${s.revision}). /verification — продолжить; /roles — изменить роли; /edit — исправить ответы.`
      : `${summary(s.draft)}\n\nОбязательные ответы сохранены. ${s.draft.roles?.includes("EXPERT") ? "Можно добавить образование или отправить анкету." : "Можно отправить анкету."} Критерии категории ещё готовятся. ${salesFirst ? "Проверка анкеты не меняет выбранные условия. Постоянная цена фиксируется только подтверждённой оплатой онбординга в срок." : "Проверка не означает одобрение; тарифы будут доступны после отдельного решения."}`,
    ...(keyboard.length
      ? { replyMarkup: { inline_keyboard: keyboard } }
      : { replyMarkup: { remove_keyboard: true as const } }),
  };
}
function textPatch(field: ResidentField, text: string): unknown {
  if (field === "roles") return { roles: text.split(/[ ,]+/u) };
  if (field === "socialLinks")
    return { socialLinks: text.trim().split(/\s+/u) };
  if (field === "amenities")
    return { amenities: text.split(",").map((v) => v.trim()) };
  if (field === "experienceYears")
    return { experienceYears: /^\d{1,3}$/u.test(text) ? Number(text) : NaN };
  if (field === "capacity")
    return { capacity: /^[1-9][0-9]{0,5}$/u.test(text) ? Number(text) : NaN };
  if (field === "averageCheckMinor") {
    const match = /^(0|[1-9][0-9]{0,9})(?:[.,]([0-9]{1,2}))?$/u.exec(text);
    if (!match) throw Error("resident_money_invalid");
    return {
      averageCheckMinor: (
        BigInt(match[1]!) * 100n +
        BigInt((match[2] ?? "").padEnd(2, "0"))
      ).toString(),
    };
  }
  return { [field]: text };
}
export function createResidentVerificationService(deps: {
  enabled: boolean;
  salesFirst?: boolean;
  wavePaymentFlow?: boolean;
  repository: ResidentFormRepository;
  policy?: ResidentPolicy;
  privateDocuments?: {
    addBrief(
      scope: ExpertApplicantScope,
      applicationId: string,
      revision: number,
      reference: ResidentDocument,
    ): Promise<{ id: string }>;
    briefStatus(
      scope: ExpertApplicantScope,
      applicationId: string,
    ): Promise<Record<string, unknown>[]>;
    confirmBrief(
      scope: ExpertApplicantScope,
      applicationId: string,
      id: string,
      revision: number,
    ): Promise<unknown>;
  };
}) {
  const render = (
    s: ResidentFormSnapshot,
    policy: ResidentPolicy,
    field?: ResidentField | null,
  ) => {
    const reply = renderForm(
      deps.salesFirst === true,
      s,
      policy,
      field,
      deps.wavePaymentFlow === true,
    );
    return deps.privateDocuments &&
      s.status === "PENDING_DOCS" &&
      reply.status === "handled"
      ? {
          ...reply,
          text:
            reply.text +
            "\nУ меня есть резюме/презентация: прикрепите PDF/DOCX с подписью /brief.",
        }
      : reply;
  };
  return {
    async handle(
      input: ResidentFormInput,
    ): Promise<ExpertApplicantReply | null> {
      if (!deps.enabled) return null;
      if (
        input.text.startsWith("/consent") ||
        (/^\/start /u.test(input.text) && !/^\/start promo_/u.test(input.text))
      )
        return null;
      let policy = deps.policy ?? residentPolicy;
      const requestAnswer =
        /^\/answer ([0-9a-f-]{36}) ([1-9]|10) ([\s\S]+)$/u.exec(input.text);
      const requestDone = /^\/answers_done ([0-9a-f-]{36})$/u.exec(input.text);
      const digest = createHash("sha256")
        .update(
          JSON.stringify({
            text: input.text,
            callbackData: input.callbackData,
            media: input.media,
          }),
        )
        .digest("hex");
      const base = {
        botId: input.botId,
        botKey: input.botKey,
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
        requestKey: `${input.botId}:${input.updateId}`,
        requestDigest: digest,
      };
      try {
        const s = await deps.repository.mutate({
          ...base,
          requestKey: base.requestKey + ":read",
          action: "start",
        });
        if (s.formVersion !== undefined && ![1, 2].includes(s.formVersion))
          return policyChanged();
        policy =
          s.formVersion === 2
            ? residentPolicyV2
            : {
                version: s.policyVersion ?? residentPolicy.version,
                education: s.educationRequirement ?? residentPolicy.education,
              };
        if (
          input.text === "/verification" ||
          input.text === "/start" ||
          /^\/start promo_/u.test(input.text)
        )
          return render(s, policy);
        if (
          deps.privateDocuments &&
          s.formVersion === 2 &&
          input.text.startsWith("/brief")
        ) {
          if (input.text === "/brief" && input.media) {
            await deps.privateDocuments.addBrief(
              input,
              s.id,
              s.revision,
              input.media,
            );
            return corrective(
              "Файл принят для приватной обработки. Проверьте результат командой /brief_status. До вашего подтверждения ответы не изменятся.",
            );
          }
          if (input.text === "/brief_status") {
            const rows = await deps.privateDocuments.briefStatus(input, s.id),
              row = rows[0];
            if (
              row?.state === "verified" &&
              row.proposal &&
              Object.keys(row.proposal as object).length &&
              JSON.stringify(row.proposal).length <= 2500
            )
              return corrective(
                "Я извлек эти данные. Верно ли? " +
                  JSON.stringify(row.proposal) +
                  `\nДля подтверждения: /brief_confirm ${String(row.id)} ${String(row.revision)}. Для исправления используйте обычные вопросы анкеты.`,
              );
            if (row && ["allocated", "inflight"].includes(String(row.state)))
              return corrective(
                "Файл ещё обрабатывается. Повторите /brief_status позже или продолжите обычные вопросы.",
              );
            return corrective(
              "Не удалось прочитать файл автоматически. Пожалуйста, ответьте на стандартные вопросы вручную.",
            );
          }
          const confirmation =
            /^\/brief_confirm ([0-9a-f-]{36}) ([0-9]{1,10})$/u.exec(input.text);
          if (confirmation) {
            await deps.privateDocuments.confirmBrief(
              input,
              s.id,
              confirmation[1]!,
              Number(confirmation[2]),
            );
            return corrective(
              "Подтверждённые ответы сохранены. Отправьте /verification, чтобы продолжить.",
            );
          }
          return corrective(
            "Прикрепите PDF/DOCX резюме или презентации с подписью /brief. Поля появятся только после вашего подтверждения.",
          );
        }
        const editMenu = (): ExpertApplicantReply => ({
          status: "handled",
          text: "Какой ответ исправить?",
          replyMarkup: {
            inline_keyboard: residentForm(
              s.draft,
              policy,
              s.formVersion ?? 1,
            ).visible.map((field) => [
              {
                text: field === "roles" ? "Роли" : labels[field].split(".")[0]!,
                callback_data: `rv:${s.id}:${s.revision}:e:${fieldCode(field)}`,
              },
            ]),
          },
        });
        if (input.text === "/edit")
          return s.status === "PENDING_DOCS" ? editMenu() : render(s, policy);

        if (
          /^\/(?:tariff|tariffs|apply|profile|my_tariff)(?: |$)/u.test(
            input.text,
          ) ||
          input.text === "Мой актуальный тариф"
        )
          return {
            status: "handled",
            text: deps.salesFirst
              ? "Выбранные условия и срок доступны в /my_tariff. Продолжить анкету: /verification."
              : "Сначала заполните анкету: /verification. Тарифы появятся после отдельного решения по проверке.",
          };
        let patch: unknown;
        let followupAnswer: string | undefined;
        let documents: ResidentDocument[] | undefined;
        let action:
          | "patch"
          | "submit"
          | "followup"
          | "question"
          | "complete"
          | "reapply" = "patch";
        let requestedField: ResidentField | null = null;
        if (input.text === "/reapply") action = "reapply";
        else if (requestDone) action = "complete";
        else if (requestAnswer && s.formVersion === 2) {
          action = "followup";
          followupAnswer = requestAnswer[3];
          if (input.media) documents = [input.media];
        } else if (
          ["UNDER_REVIEW", "INFO_REQUESTED"].includes(s.status) &&
          s.formVersion !== 2 &&
          !input.callbackData &&
          !input.text.startsWith("/")
        ) {
          action = "followup";
          if (input.media) documents = [input.media];
          if (input.text.trim()) followupAnswer = input.text;
          if (!documents && !followupAnswer)
            throw Error("resident_invalid_answer");
        } else if (input.text === "/roles") {
          action = "question";
          requestedField = "roles";
        } else if (input.callbackData) {
          const match =
            /^rv:([0-9a-f-]{36}):([0-9]{1,10}):([a-z]+)(?::([A-Z_a-z0-9]+))?$/u.exec(
              input.callbackData,
            );
          if (!match || match[1] !== s.id) return { status: "rejected" };
          if (Number(match[2]) !== s.revision) return render(s, policy);
          const op = match[3],
            value = match[4];
          if (op === "edit")
            return s.status === "PENDING_DOCS" ? editMenu() : render(s, policy);
          if (op === "back") {
            if (
              !s.currentField ||
              !["education", "licence"].includes(s.currentField) ||
              !residentForm(
                s.draft,
                policy,
                s.formVersion ?? 1,
              ).visible.includes(s.currentField) ||
              residentForm(
                s.draft,
                policy,
                s.formVersion ?? 1,
              ).required.includes(s.currentField)
            )
              throw Error("resident_callback_invalid");
            action = "question";
            requestedField = null;
          } else if (["rm", "clear", "replace"].includes(op ?? "")) {
            const [code, position] = value?.split("_") ?? [],
              field = code ? fieldCodes[code] : undefined;
            if (
              !residentDocumentFields.includes(
                field as (typeof residentDocumentFields)[number],
              ) ||
              !residentForm(
                s.draft,
                policy,
                s.formVersion ?? 1,
              ).visible.includes(field!)
            )
              throw Error("resident_callback_invalid");
            const docs = [...((s.draft[field!] ?? []) as ResidentDocument[])];
            if (op === "rm") {
              if (
                position === undefined ||
                !/^\d$/u.test(position) ||
                Number(position) >= docs.length
              )
                throw Error("resident_callback_invalid");
              docs.splice(Number(position), 1);
            }
            patch = { [field!]: op === "rm" ? docs : [] };
            requestedField = field ?? null;
          } else if (op === "roles") {
            action = "question";
            requestedField = "roles";
          } else if (op === "next") {
            action = "question";
            requestedField = residentForm(
              s.draft,
              policy,
              s.formVersion ?? 1,
            ).next;
          } else if (
            op === "e" &&
            value !== undefined &&
            residentForm(s.draft, policy, s.formVersion ?? 1).visible.includes(
              fieldCodes[value]!,
            )
          ) {
            action = "question";
            requestedField = fieldCodes[value]!;
          } else if (op === "submit") action = "submit";
          else if (
            op === "r" &&
            residentRoles.includes(value as (typeof residentRoles)[number])
          ) {
            const roles = [...(s.draft.roles ?? [])];
            const at = roles.indexOf(value as (typeof roles)[number]);
            if (at >= 0) roles.splice(at, 1);
            else roles.push(value as (typeof roles)[number]);
            if (!roles.length) return render(s, policy, "roles");
            patch = rolePatch(s.draft, roles);
            requestedField = "roles";
          } else if (op === "p") patch = { primaryRole: value };
          else if (op === "c") patch = { category: value };
          else if (op === "t")
            patch = {
              tax:
                (
                  {
                    s: "SELF_EMPLOYED",
                    i: "IP",
                    l: "LLC",
                    n:
                      s.formVersion === 2
                        ? "INDIVIDUAL_NO_STATUS"
                        : "INDIVIDUAL",
                  } as Record<string, string>
                )[value!] ?? value,
            };
          else if (
            op === "a" &&
            ["wifi", "parking", "equipment", "other", "none"].includes(
              value ?? "",
            )
          ) {
            const choices = (s.draft.amenities ?? []).filter(
              (v) => v !== "none",
            );
            const found = choices.indexOf(value!);
            if (found >= 0) choices.splice(found, 1);
            else choices.push(value!);
            patch = { amenities: value === "none" ? ["none"] : choices };
            requestedField = "amenities";
          } else throw Error("resident_callback_invalid");
        } else if (input.media) {
          const cursor =
            s.currentField ??
            residentForm(s.draft, policy, s.formVersion ?? 1).next;
          if (
            !residentDocumentFields.includes(
              cursor as (typeof residentDocumentFields)[number],
            ) ||
            !cursor ||
            !residentForm(s.draft, policy, s.formVersion ?? 1).visible.includes(
              cursor,
            )
          )
            throw Error("resident_media_unexpected");
          patch = {
            [cursor]: [
              ...((s.draft[cursor] ?? []) as ResidentDocument[]),
              input.media,
            ],
          };
          if (s.currentField === cursor) requestedField = cursor;
        } else {
          const edit = /^\/set ([A-Za-z]+) ([\s\S]+)$/u.exec(input.text);
          const field = edit
            ? (edit[1] as ResidentField)
            : (s.currentField ??
              residentForm(s.draft, policy, s.formVersion ?? 1).next);
          if (["INFO_REQUESTED", "UNDER_REVIEW"].includes(s.status)) {
            action = "followup";
          } else {
            if (
              !field ||
              !Object.hasOwn(labels, field) ||
              (input.text.startsWith("/") && !edit)
            )
              return render(s, policy);
            patch = textPatch(field, edit?.[2] ?? input.text);
            if (field === "roles")
              patch = rolePatch(
                s.draft,
                (patch as { roles: NonNullable<ResidentDraft["roles"]> }).roles,
              );
          }
        }
        const updated = await deps.repository.mutate({
          ...base,
          applicationId: s.id,
          expectedRevision: s.revision,
          action,
          ...(requestAnswer
            ? {
                requestId: requestAnswer[1]!,
                questionNumber: Number(requestAnswer[2]),
              }
            : requestDone
              ? { requestId: requestDone[1]! }
              : {}),
          ...(patch === undefined ? {} : { patch }),
          ...(requestedField ? { field: requestedField } : {}),
          ...(action === "followup"
            ? {
                ...(followupAnswer === undefined
                  ? {}
                  : { answer: followupAnswer }),
                ...(documents === undefined ? {} : { documents }),
              }
            : {}),
        });
        // Replays use the originally stored response snapshot, never reapply an answer.
        return render(
          updated,
          policy,
          requestedField ??
            residentForm(updated.draft, policy, updated.formVersion ?? 1).next,
        );
      } catch (error) {
        if (error instanceof Error && error.message === "resident_legacy_flow")
          return null;
        if (
          error instanceof Error &&
          [
            "resident_patch_invalid",
            "resident_money_invalid",
            "resident_incomplete",
            "resident_media_unexpected",
            "resident_invalid_answer",
            "resident_invalid_documents",
            "resident_invalid_field",
            "resident_invalid_request",
            "resident_invalid_revision",
            "resident_draft_too_large",
          ].includes(error.message)
        )
          return corrective();
        if (
          error instanceof Error &&
          [
            "resident_callback_invalid",
            "resident_identity_unavailable",
            "resident_application_unavailable",
            "resident_idempotency_conflict",
          ].includes(error.message)
        )
          return { status: "rejected" };
        if (
          error instanceof Error &&
          error.message === "resident_policy_conflict"
        )
          return policyChanged();
        if (
          error instanceof Error &&
          [
            "resident_revision_conflict",
            "private_proposal_stale",
            "resident_submission_frozen",
            "resident_followup_unavailable",
            "resident_reapply_unavailable",
          ].includes(error.message)
        )
          return {
            status: "handled",
            text: "Состояние анкеты изменилось. Отправьте /verification, чтобы продолжить с актуального вопроса.",
          };
        return { status: "unavailable" };
      }
    },
  };
}

export type { ResidentDocument } from "@ii-tonya/domain";
