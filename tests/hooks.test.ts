import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTracker } from '../src/index.js';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('onStart', () => {
  it('fires once per fire() call', async () => {
    const onStart = vi.fn();
    const t = createTracker({ onStart });
    t.fire(Promise.resolve());
    t.fire(Promise.resolve());
    await t.drain();
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('receives meta with id and startedAt', async () => {
    const onStart = vi.fn();
    const t = createTracker({ onStart });
    t.fire(Promise.resolve());
    await t.drain();
    const meta = onStart.mock.calls[0]![0];
    expect(meta.id).toBe(0);
    expect(typeof meta.startedAt).toBe('number');
  });

  it('fires before the task settles', async () => {
    const order: string[] = [];
    const onStart = vi.fn(() => order.push('start'));
    const onSettle = vi.fn(() => order.push('settle'));
    const t = createTracker({ onStart, onSettle });
    t.fire(Promise.resolve());
    await t.drain();
    expect(order).toEqual(['start', 'settle']);
  });
});

describe('onSettle', () => {
  it('fires when a task resolves', async () => {
    const onSettle = vi.fn();
    const t = createTracker({ onSettle });
    t.fire(Promise.resolve());
    await t.drain();
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it('fires when a task rejects', async () => {
    const onSettle = vi.fn();
    const t = createTracker({ onSettle, onError: vi.fn() });
    t.fire(Promise.reject(new Error('boom')));
    await t.drain();
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it('sets meta.durationMs to a non-negative number', async () => {
    const onSettle = vi.fn();
    const t = createTracker({ onSettle });
    t.fire(delay(5));
    await t.drain();
    expect(onSettle.mock.calls[0]![0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('fires after onError when a task rejects', async () => {
    const order: string[] = [];
    const t = createTracker({
      onError: () => order.push('error'),
      onSettle: () => order.push('settle'),
    });
    t.fire(Promise.reject(new Error('boom')));
    await t.drain();
    expect(order).toEqual(['error', 'settle']);
  });
});

describe('onError', () => {
  it('fires when a task rejects', async () => {
    const onError = vi.fn();
    const t = createTracker({ onError });
    t.fire(Promise.reject(new Error('boom')));
    await t.drain();
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0]![0] as Error).message).toBe('boom');
  });

  it('receives meta with id and startedAt', async () => {
    const onError = vi.fn();
    const t = createTracker({ onError });
    t.fire(Promise.reject(new Error('boom')));
    await t.drain();
    const meta = onError.mock.calls[0]![1];
    expect(meta.id).toBe(0);
    expect(typeof meta.startedAt).toBe('number');
  });

  it('falls back to console.error when no onError is given', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = createTracker();
    t.fire(Promise.reject(new Error('boom')));
    await t.drain();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('throwing user hooks do not escape the tracked chain', () => {
  let unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.restoreAllMocks();
  });

  it('a throwing onStart still lets the task settle', async () => {
    const onSettle = vi.fn();
    const t = createTracker({
      onStart: () => {
        throw new Error('onStart boom');
      },
      onSettle,
    });
    t.fire(delay(5));
    expect(t.inflight()).toBe(1);
    await t.drain();
    expect(onSettle).toHaveBeenCalledOnce();
    expect(unhandled).toHaveLength(0);
  });

  it('a throwing onError does not produce an unhandled rejection', async () => {
    const t = createTracker({
      onError: () => {
        throw new Error('onError boom');
      },
    });
    t.fire(Promise.reject(new Error('task failed')));
    await t.drain();
    await delay(10);
    expect(unhandled).toHaveLength(0);
  });

  it('a throwing onSettle does not break entry cleanup', async () => {
    const t = createTracker({
      onSettle: () => {
        throw new Error('onSettle boom');
      },
    });
    t.fire(delay(5));
    t.fire(delay(5));
    await t.drain();
    await delay(10);
    expect(t.inflight()).toBe(0);
    expect(unhandled).toHaveLength(0);
  });
});

describe('re-entry: fire() from inside a hook', () => {
  it('a follow-up fire() from onSettle is registered after the original drain completes', async () => {
    const seen: number[] = [];
    const t = createTracker({
      onSettle: (meta) => {
        seen.push(meta.id);
        if (meta.id === 0) {
          t.fire(Promise.resolve(), { label: 'follow-up' });
        }
      },
    });
    t.fire(Promise.resolve());
    await t.drain();
    // The original drain returns after the first task settles; the follow-up
    // task is still in flight because it was fired from inside that task's
    // onSettle (after the drain's snapshot was taken).
    expect(seen).toContain(0);
    await t.drain();
    expect(seen).toEqual([0, 1]);
    expect(t.inflight()).toBe(0);
  });
});
