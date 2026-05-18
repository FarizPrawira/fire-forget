import { describe, expect, it } from 'vitest';
import { createTracker } from '../src/index.js';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('drain()', () => {
  it('resolves immediately on an empty tracker', async () => {
    const t = createTracker();
    const result = await t.drain();
    expect(result).toEqual({ drained: 0, remaining: 0, timedOut: false });
  });

  it('waits for every pending task to settle', async () => {
    const t = createTracker();
    t.fire(delay(10));
    t.fire(delay(15));
    t.fire(delay(5));
    const result = await t.drain();
    expect(result).toEqual({ drained: 3, remaining: 0, timedOut: false });
    expect(t.inflight()).toBe(0);
  });

  it('returns timedOut: false when no timeoutMs is given', async () => {
    const t = createTracker();
    t.fire(Promise.resolve());
    const result = await t.drain();
    expect(result.timedOut).toBe(false);
  });
});

describe('drain({ timeoutMs })', () => {
  it('resolves with timedOut: false when tasks finish in budget', async () => {
    const t = createTracker();
    t.fire(delay(5));
    const result = await t.drain({ timeoutMs: 100 });
    expect(result.timedOut).toBe(false);
    expect(result.drained).toBe(1);
  });

  it('resolves with timedOut: true and remaining > 0 when tasks exceed budget', async () => {
    const t = createTracker();
    t.fire(delay(200));
    t.fire(delay(200));
    const result = await t.drain({ timeoutMs: 20 });
    expect(result.timedOut).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
    await t.drain(); // clean up
  });

  it('reports all tasks as remaining when timeoutMs is 0', async () => {
    const t = createTracker();
    t.fire(delay(50));
    t.fire(delay(50));
    const result = await t.drain({ timeoutMs: 0 });
    expect(result.timedOut).toBe(true);
    expect(result.remaining).toBe(2);
    await t.drain();
  });
});

describe('drain({ abortOnTimeout })', () => {
  it('aborts signal-aware tasks on drain timeout', async () => {
    const t = createTracker();
    let captured: AbortSignal | undefined;
    t.fire((signal) => {
      captured = signal;
      return new Promise<void>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const result = await t.drain({ timeoutMs: 20, abortOnTimeout: true });
    expect(captured?.aborted).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('leaves plain promises in remaining', async () => {
    const t = createTracker();
    let resolveIt!: () => void;
    t.fire(new Promise<void>((r) => { resolveIt = r; }));
    const result = await t.drain({ timeoutMs: 20, abortOnTimeout: true });
    expect(result.remaining).toBe(1);
    resolveIt();
    await t.drain();
  });

  it('does not abort when the budget is met', async () => {
    const aborted: boolean[] = [];
    const t = createTracker();
    t.fire((signal) => {
      signal.addEventListener('abort', () => aborted.push(true));
      return delay(5);
    });
    await t.drain({ timeoutMs: 100, abortOnTimeout: true });
    expect(aborted).toEqual([]);
  });

  it('is a no-op when no tasks are pending at timeout', async () => {
    const t = createTracker();
    const result = await t.drain({ timeoutMs: 20, abortOnTimeout: true });
    expect(result).toEqual({ drained: 0, remaining: 0, timedOut: false });
  });

  it('without abortOnTimeout, drain timeout leaves tasks running', async () => {
    const aborted: boolean[] = [];
    const t = createTracker();
    let resolveIt!: () => void;
    t.fire((signal) => {
      signal.addEventListener('abort', () => aborted.push(true));
      return new Promise<void>((r) => { resolveIt = r; });
    });
    await t.drain({ timeoutMs: 20 });
    expect(aborted).toEqual([]);
    resolveIt();
    await t.drain();
  });
});

describe('drain() snapshot semantics', () => {
  it('excludes tasks fired after drain() has been entered', async () => {
    const t = createTracker();
    t.fire(delay(5));
    const drainPromise = t.drain();
    t.fire(delay(100)); // fired after drain entered; outlives the original drain
    const result = await drainPromise;
    expect(result.drained).toBe(1);
    // The late-fired task is still pending — drain's snapshot was taken before it existed.
    expect(t.inflight()).toBe(1);
    await t.drain();
  });
});
