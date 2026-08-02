import type {
  CanonicalSelartiEvent,
  SelartiPort,
  SelartiSendOutcome,
} from "./selarti-port.js";

export class DisabledSelartiAdapter implements SelartiPort {
  async decodeVerifiedWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<CanonicalSelartiEvent> {
    void rawBody;
    void headers;
    throw new Error("Selarti integration is disabled");
  }

  async sendMessage(command: {
    idempotencyKey: string;
    channelUserId: string;
    text: string;
  }): Promise<SelartiSendOutcome> {
    void command;
    throw new Error("Selarti integration is disabled");
  }
}
