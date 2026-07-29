export class TransportFailure extends Error {
  constructor(readonly phase: "before_write" | "after_write") {
    super(`Transport failed ${phase}`);
    this.name = "TransportFailure";
  }
}
