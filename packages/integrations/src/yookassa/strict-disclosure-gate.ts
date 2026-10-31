/**
 * Single-process ordering primitive, not a production disclosure capability.
 * A caller must independently ensure exclusive egress and crash fencing.
 * `beginSend` must synchronously begin the actual network write before returning.
 */
export class StrictDisclosureGate {
  private readonly erased = new Set<string>();

  async send(
    subject: string,
    authorize: () => Promise<void>,
    beginSend: () => Promise<void>,
  ): Promise<'started' | 'cancelled'> {
    if (this.erased.has(subject)) return 'cancelled';
    await authorize();
    if (this.erased.has(subject)) return 'cancelled';
    const result = beginSend();
    await result;
    return 'started';
  }

  async erase(subject: string, persist: () => Promise<void>): Promise<void> {
    this.erased.add(subject);
    await persist();
  }
}
