import { expect } from "vitest";
export type TagOwnerReply = {
  text?: string;
  duplicate?: boolean;
  reply_markup?: {
    inline_keyboard: { text: string; callback_data: string }[][];
  };
};
export function semanticTagOwnerFlow(
  send: (
    payload: Record<string, unknown>,
  ) => Promise<{ statusCode: number; json(): TagOwnerReply }>,
  scope: { chatId: string; botId: string },
  next: () => number,
) {
  let last: Record<string, unknown> = {};
  const post = async (payload: Record<string, unknown>) => {
    last = payload;
    const response = await send(payload);
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  const text = (value: string) => {
    const update = next();
    return post({
      update_id: update,
      message: {
        message_id: update,
        from: { id: Number(scope.chatId) },
        chat: { id: Number(scope.chatId), type: "private" },
        text: value,
      },
    });
  };
  const click = (
    reply: TagOwnerReply,
    choose: (button: { text: string; callback_data: string }) => boolean,
  ) => {
    const button = reply.reply_markup?.inline_keyboard.flat().find(choose);
    if (!button) throw new Error("owner_button_missing");
    const update = next();
    return post({
      update_id: update,
      callback_query: {
        id: "owner_tag_" + update,
        from: { id: Number(scope.chatId) },
        message: {
          message_id: update,
          from: { id: Number(scope.botId), is_bot: true },
          chat: { id: Number(scope.chatId), type: "private" },
          text: reply.text,
        },
        data: button.callback_data,
      },
    });
  };
  return {
    text,
    click,
    repeat: () => post(last),
    async catalogue(label: string) {
      let r = await text("/tags");
      for (let page = 0; page < 30; page++) {
        if (
          r.reply_markup?.inline_keyboard.flat().some((b) => b.text === label)
        )
          return click(r, (b) => b.text === label);
        r = await click(r, (b) => b.text === "→");
      }
      throw new Error("catalogue_label_missing");
    },
    remove: (r: TagOwnerReply, label: string) =>
      click(
        r,
        (b) => b.callback_data.startsWith("ct2:t:") && b.text.endsWith(label),
      ),
    confirm: (r: TagOwnerReply) =>
      click(r, (b) => b.callback_data.startsWith("ct2:c:")),
  };
}
