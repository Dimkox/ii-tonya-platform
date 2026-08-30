export type ParticipantSegment = "EXPERT" | "CENTER" | "ORGANIZER";
export type ParticipantKindInput =
  | ParticipantSegment
  | "expert"
  | "center"
  | "studio"
  | "salon"
  | "retreat-center"
  | "organizer"
  | "festival"
  | "retreat"
  | "travel"
  | "эксперт"
  | "центр"
  | "студия"
  | "салон"
  | "ретрит-центр"
  | "организатор"
  | "фестиваль"
  | "ретрит"
  | "путешествия";
export function segmentParticipant(
  input: ParticipantKindInput,
): ParticipantSegment {
  if (input === "EXPERT" || input === "expert" || input === "эксперт")
    return "EXPERT";
  if (
    input === "ORGANIZER" ||
    input === "organizer" ||
    input === "festival" ||
    input === "retreat" ||
    input === "travel" ||
    input === "организатор" ||
    input === "фестиваль" ||
    input === "ретрит" ||
    input === "путешествия"
  )
    return "ORGANIZER";
  if (
    input === "CENTER" ||
    input === "center" ||
    input === "studio" ||
    input === "salon" ||
    input === "retreat-center" ||
    input === "центр" ||
    input === "студия" ||
    input === "салон" ||
    input === "ретрит-центр"
  )
    return "CENTER";
  throw new Error("participant_kind_invalid");
}
