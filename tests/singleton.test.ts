import { describe, expect, it, vi } from 'vitest';
import { configureDefault, drain, fire, inflight } from '../src/index.js';

// NOTE: All tests in this file share one module-level singleton. Order matters:
// configureDefault() must run before any fire/drain/inflight call. Vitest runs
// each test file in an isolated module instance, so other test files don't
// interfere — but tests within this file do.

describe('default singleton (with configureDefault first)', () => {
  it('configureDefault installs hooks on the default tracker before first use', async () => {
    const onSettle = vi.fn();
    configureDefault({ onSettle });
    fire(Promise.resolve());
    await drain();
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it('configureDefault throws if called after the default tracker has been touched', () => {
    expect(() => configureDefault({})).toThrow(/before the first fire/);
  });
});

describe('default singleton exports', () => {
  it('expose shared fire/drain/inflight state', async () => {
    expect(inflight()).toBe(0);
    fire(Promise.resolve());
    fire(Promise.resolve());
    expect(inflight()).toBe(2);
    const result = await drain();
    expect(result.drained).toBe(2);
    expect(inflight()).toBe(0);
  });
});
