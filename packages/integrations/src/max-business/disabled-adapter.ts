import type {
  MaxBusinessPort,
  MaxBusinessSendCommand,
  MaxBusinessWebhookCommand,
} from "./port.js";
export class MaxBusinessDisabledError extends Error {
  readonly code = "MAX_BUSINESS_DISABLED" as const;
  constructor() {
    super("max_business_disabled");
    this.name = "MaxBusinessDisabledError";
  }
}
export class DisabledMaxBusinessAdapter implements MaxBusinessPort {
  constructor(enabled: boolean = false) {
    if (enabled !== false) throw new MaxBusinessDisabledError();
    Object.freeze(this);
  }
  async sendMessage(command: MaxBusinessSendCommand): Promise<never> {
    void command;
    throw new MaxBusinessDisabledError();
  }
  async acceptWebhook(command: MaxBusinessWebhookCommand): Promise<never> {
    void command;
    throw new MaxBusinessDisabledError();
  }
}
