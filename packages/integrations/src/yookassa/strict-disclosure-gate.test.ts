import { describe, expect, it } from 'vitest';
import { StrictDisclosureGate } from './strict-disclosure-gate.js';

describe('strict disclosure gate', () => {
  it('cancels a queued first send when deletion starts before authorization completes', async () => {
    let release!: () => void;
    const authorization = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const gate = new StrictDisclosureGate();
    const send = gate.send('person', async () => { await authorization; }, () => { events.push('send'); return Promise.resolve(); });
    await gate.erase('person', async () => { events.push('delete'); });
    release();
    expect(await send).toBe('cancelled');
    expect(events).toEqual(['delete']);
  });
  it('does not initiate a send after persistence fails', async () => {
    const gate = new StrictDisclosureGate();
    await expect(gate.erase('person', async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    let started = false;
    expect(await gate.send('person', async () => {}, () => { started = true; return Promise.resolve(); })).toBe('cancelled');
    expect(started).toBe(false);
  });
  it('allows an independent subject to send', async () => {
    const gate = new StrictDisclosureGate();
    await gate.erase('first', async () => {});
    expect(await gate.send('second', async () => {}, () => Promise.resolve())).toBe('started');
  });
});
