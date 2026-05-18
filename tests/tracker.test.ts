import { describe, expect, it } from 'vitest';
import { createTracker } from '../src/index.js';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('createTracker()', () => {
  it('returns a usable Tracker with no opts', async () => {
    const t = createTracker();
    expect(typeof t.fire).toBe('function');
    expect(typeof t.drain).toBe('function');
    expect(typeof t.inflight).toBe('function');
    t.fire(Promise.resolve());
    await t.drain();
    expect(t.inflight()).toBe(0);
  });

  it('isolates entries between instances', async () => {
    const a = createTracker();
    const b = createTracker();
    a.fire(delay(10));
    expect(a.inflight()).toBe(1);
    expect(b.inflight()).toBe(0);
    await a.drain();
    expect(b.inflight()).toBe(0);
  });

  it('isolates hooks between instances', async () => {
    const onSettleA: number[] = [];
    const onSettleB: number[] = [];
    const a = createTracker({ onSettle: (m) => onSettleA.push(m.id) });
    const b = createTracker({ onSettle: (m) => onSettleB.push(m.id) });
    a.fire(Promise.resolve());
    b.fire(Promise.resolve());
    await Promise.all([a.drain(), b.drain()]);
    expect(onSettleA).toEqual([0]);
    expect(onSettleB).toEqual([0]);
  });
});
