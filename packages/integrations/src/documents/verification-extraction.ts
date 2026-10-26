/** A deterministic labelled-field reader, not a language model or document instruction interpreter. */
const fields: Record<string, string> = {
  город: "city",
  мотивация: "motivation",
  специализация: "specialization",
  методы: "methods",
  опыт: "experienceYears",
  путь: "path",
  кейсы: "cases",
  "тип помещения": "premisesType",
  "формат мероприятий": "eventFormat",
  программа: "programme",
  спикеры: "speakers",
  "прошлые мероприятия": "pastEvents",
  "название проекта": "projectName",
  преподаватели: "teachingTeam",
  "отзывы выпускников": "graduateReviews",
};
function labelled(content: string) {
  const entries = new Map<string, string | null>();
  for (const line of content.split(/\r?\n/u).slice(0, 1000)) {
    const m = /^([^:\n]{1,60}):\s*(.{1,3000})$/u.exec(line.trim());
    if (!m) continue;
    const key = m[1]!.toLocaleLowerCase("ru");
    entries.set(key, entries.has(key) ? null : m[2]!.trim());
  }
  return entries;
}
export function proposeVerificationFields(
  content: string,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const proposal: Record<string, unknown> = {};
  if (Buffer.byteLength(content) > 64000) return proposal;
  for (const [label, value] of labelled(content)) {
    const field = fields[label];
    if (
      !field ||
      !value ||
      draft[field] !== undefined ||
      /[\u0000-\u001f\u007f]/u.test(value)
    )
      continue;
    if (field === "experienceYears") {
      if (/^(?:[0-9]|[1-9][0-9]|100)$/u.test(value))
        proposal[field] = Number(value);
    } else if (
      value.length <=
      (field === "city" ? 120 : field === "specialization" ? 300 : 3000)
    )
      proposal[field] = value;
    if (
      JSON.stringify(proposal).length > 2500 ||
      Buffer.byteLength(JSON.stringify(proposal)) > 16000
    )
      delete proposal[field];
  }
  return proposal;
}
export function compareEducation(
  content: string | null,
  claimed: string | undefined,
  complete: boolean,
) {
  const base = {
    authenticity: "unverified",
    medicalLicence: "human_review_only",
    institution: null as string | null,
    specialty: null as string | null,
    year: null as number | null,
  };
  if (content === null) return { ...base, result: "NO_DOCUMENT" };
  if (!complete || Buffer.byteLength(content) > 64000)
    return { ...base, result: "UNKNOWN" };
  const labels = labelled(content),
    institution = labels.get("учебное заведение") ?? null,
    specialty = labels.get("специальность") ?? null,
    yearText = labels.get("год"),
    year =
      yearText && /^(19|20)\d{2}$/u.test(yearText) ? Number(yearText) : null;
  const normalized = (s: string) =>
    s
      .normalize("NFKC")
      .toLocaleLowerCase("ru")
      .replace(/ё/gu, "е")
      .replace(/\s+/gu, " ")
      .trim();
  return {
    ...base,
    institution: institution?.slice(0, 200) ?? null,
    specialty: specialty?.slice(0, 200) ?? null,
    year,
    result:
      claimed && specialty
        ? normalized(claimed) === normalized(specialty)
          ? "MATCH"
          : "MISMATCH"
        : "UNKNOWN",
  };
}
