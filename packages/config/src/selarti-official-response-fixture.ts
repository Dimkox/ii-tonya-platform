/**
 * Documented Selarti "All messages" webhook sample.
 * Source: https://manual.selarti.com/manual-en/external-integrations/integration-with-an-external-messenger
 * Identifiers are the public manual example, not a live tenant.
 * Selarti may add fields (manager_id is already extra relative to the parameter table).
 */
export const SELARTI_ALL_MESSAGES_FIXTURE = {
  channel_id: "5q",
  close: "no",
  company_id: "1708251850060x460235863640434700",
  contacts: "123456789",
  dialog: "User: Hello! Bot: Hello! How can I help you?",
  external_chat_id: "123456789",
  get_contact: "no",
  interest: "no",
  is_bot: "no",
  manager_id: "4q",
  message_id: "1731336491876x582725124419040400",
  message_text:
    "It looks like you are testing API functionality by sending a test message along with metadata like a timestamp and timezone. If you have any questions or need assistance with this, feel free to ask!",
  message_type: "bot",
  operator: "no",
  panel_url:
    "https://selarti.com/panel?menu=chats&thread=1731336491572x316716105037601100",
  share_url:
    "https://selarti.com/share?thread=1731336491572x316716105037601100",
  success: "no",
  task_id: "1721129985149x478019552540622850",
  task_name: "Client consultation",
  thread_id: "1731336491572x316716105037601100",
  title: "API chat 123456789",
  wh_type: "all_messages",
} as const;

export function assertSelartiOfficialResponseFixture(): void {
  const fixture = SELARTI_ALL_MESSAGES_FIXTURE;
  if (
    fixture.wh_type !== "all_messages" ||
    (fixture.message_type !== "bot" && fixture.message_type !== "operator") ||
    fixture.external_chat_id.length < 1 ||
    fixture.external_chat_id !== fixture.contacts ||
    fixture.message_id.length < 1 ||
    fixture.task_id.length < 1 ||
    fixture.thread_id.length < 1 ||
    fixture.message_text.length < 1 ||
    fixture.message_text.length > 4_096 ||
    fixture.manager_id.length < 1 ||
    !fixture.panel_url.startsWith("https://") ||
    !fixture.share_url.startsWith("https://")
  ) {
    throw new Error("selarti_response_official_fixture_invalid");
  }
}
