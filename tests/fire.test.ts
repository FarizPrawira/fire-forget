import { describe, expect, it, vi } from 'vitest';
import { createTracker } from '../src/index.js';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('fire(input)', () => {
  it('accepts a plain Promise', async () => {
    const t = createTracker();
    t.fire(Promise.resolve(42));
    expect(t.inflight()).toBe(1);
    await t.drain();
    expect(t.inflight()).toBe(0);
  });

  it('accepts a zero-arg thunk and invokes it synchronously', () => {
    const t = createTracker();
    const fn = vi.fn(async () => undefined);
    t.fire(fn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('passes an AbortSignal to a signal-aware thunk', () => {
    const t = createTracker();
    let received: AbortSignal | undefined;
    t.fire((signal) => {
      received = signal;
      return Promise.resolve();
    });
    expect(received).toBeInstanceOf(AbortSignal);
    expect(received?.aborted).toBe(false);
  });

  it('captures a synchronous throw from a thunk as a rejection', async () => {
    const onError = vi.fn();
    const t = createTracker({ onError });
    t.fire(() => {
      throw new Error('sync throw');
    });
    await t.drain();
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0]![0] as Error).message).toBe('sync throw');
  });

  it('returns void', () => {
    const t = createTracker();
    const result = t.fire(Promise.resolve());
    expect(result).toBeUndefined();
  });
});

describe('fire(input, { label })', () => {
  it('surfaces the label on TaskMeta.label', async () => {
    const onSettle = vi.fn();
    const t = createTracker({ onSettle });
    t.fire(Promise.resolve(), { label: 'analytics' });
    await t.drain();
    expect(onSettle.mock.calls[0]![0].label).toBe('analytics');
  });

  it('omits label on TaskMeta when not provided', async () => {
    const onSettle = vi.fn();
    const t = createTracker({ onSettle });
    t.fire(Promise.resolve());
    await t.drain();
    expect(onSettle.mock.calls[0]![0].label).toBeUndefined();
  });
});

describe('fire() task registration', () => {
  it('increments inflight() immediately', () => {
    const t = createTracker();
    expect(t.inflight()).toBe(0);
    t.fire(delay(20));
    expect(t.inflight()).toBe(1);
    t.fire(delay(20));
    expect(t.inflight()).toBe(2);
  });

  it('decrements inflight() after the task settles', async () => {
    const t = createTracker();
    t.fire(delay(5));
    await t.drain();
    expect(t.inflight()).toBe(0);
  });

  it('assigns monotonically increasing ids per tracker', async () => {
    const ids: number[] = [];
    const t = createTracker({ onSettle: (meta) => ids.push(meta.id) });
    t.fire(Promise.resolve());
    t.fire(Promise.resolve());
    t.fire(Promise.resolve());
    await t.drain();
    expect(ids).toEqual([0, 1, 2]);
  });

  it('resets id counter per createTracker instance', async () => {
    const idsA: number[] = [];
    const idsB: number[] = [];
    const a = createTracker({ onSettle: (m) => idsA.push(m.id) });
    const b = createTracker({ onSettle: (m) => idsB.push(m.id) });
    a.fire(Promise.resolve());
    a.fire(Promise.resolve());
    b.fire(Promise.resolve());
    await Promise.all([a.drain(), b.drain()]);
    expect(idsA).toEqual([0, 1]);
    expect(idsB).toEqual([0]);
  });
});
