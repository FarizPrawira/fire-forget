import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTracker, TimeoutError } from '../src/index.js';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('fire(..., { timeoutMs })', () => {
  it('rejects with TimeoutError when the budget elapses', async () => {
    const onError = vi.fn();
    const t = createTracker({ onError });
    t.fire(delay(100), { timeoutMs: 10 });
    await t.drain();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(TimeoutError);
  });

  it('sets meta.timedOut to true on the onError meta', async () => {
    const onError = vi.fn();
    const t = createTracker({ onError });
    t.fire(delay(100), { timeoutMs: 10 });
    await t.drain();
    expect(onError.mock.calls[0]![1].timedOut).toBe(true);
  });

  it('does not fire onError when the task completes in budget', async () => {
    const onError = vi.fn();
    const t = createTracker({ onError });
    t.fire(delay(5), { timeoutMs: 100 });
    await t.drain();
    expect(onError).not.toHaveBeenCalled();
  });

  it('aborts the AbortSignal passed to a signal-aware thunk', async () => {
    const t = createTracker({ onError: vi.fn() });
    let captured: AbortSignal | undefined;
    t.fire(
      (signal) => {
        captured = signal;
        return new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
      { timeoutMs: 10 },
    );
    await t.drain();
    expect(captured?.aborted).toBe(true);
  });
});

describe('TimeoutError', () => {
  it('has name "TimeoutError"', () => {
    expect(new TimeoutError(100).name).toBe('TimeoutError');
  });

  it('is an instance of Error', () => {
    expect(new TimeoutError(100)).toBeInstanceOf(Error);
  });

  it('includes the budget in its message', () => {
    expect(new TimeoutError(250).message).toMatch(/250/);
  });
});

describe('late-settling timed-out task', () => {
  let unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  it('does not double-fire hooks when the original promise resolves after timeout', async () => {
    const onError = vi.fn();
    const onSettle = vi.fn();
    const t = createTracker({ onError, onSettle });
    t.fire(delay(200), { timeoutMs: 20 });
    await t.drain();
    expect(onError).toHaveBeenCalledOnce();
    expect(onSettle).toHaveBeenCalledOnce();
    await delay(220);
    expect(onError).toHaveBeenCalledOnce();
    expect(onSettle).toHaveBeenCalledOnce();
    expect(t.inflight()).toBe(0);
    expect(unhandled).toHaveLength(0);
  });

  it('does not surface a late rejection as unhandled', async () => {
    const t = createTracker({ onError: vi.fn() });
    const lateReject = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('late failure')), 200);
    });
    t.fire(lateReject, { timeoutMs: 20 });
    await t.drain();
    await delay(220);
    expect(unhandled).toHaveLength(0);
  });
});
