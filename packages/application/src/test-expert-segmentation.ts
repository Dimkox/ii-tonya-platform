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
  | "travel";
export function segmentParticipant(
  input: ParticipantKindInput,
): ParticipantSegment {
  if (input === "EXPERT" || input === "expert") return "EXPERT";
  if (
    input === "ORGANIZER" ||
    input === "organizer" ||
    input === "festival" ||
    input === "retreat" ||
    input === "travel"
  )
    return "ORGANIZER";
  if (
    input === "CENTER" ||
    input === "center" ||
    input === "studio" ||
    input === "salon" ||
    input === "retreat-center"
  )
    return "CENTER";
  throw new Error("participant_kind_invalid");
}
