import { withTimeout } from './timeout.js';
import { TimeoutError } from './types.js';
import type {
  DrainOptions,
  DrainResult,
  FireInput,
  FireOptions,
  TaskMeta,
  Tracker,
  TrackerOptions,
} from './types.js';

const ABORT_GRACE_MS = 100;

interface Entry {
  promise: Promise<unknown>;
  controller: AbortController | undefined;
}

function defaultErrorHandler(err: unknown, meta: TaskMeta): void {
  console.error('[fire-forget] detached task failed', { meta, err });
}

function safeCall(fn: (() => void) | undefined, hook: string): void {
  if (fn === undefined) return;
  try {
    fn();
  } catch (callbackErr) {
    // A throwing user hook must not escape the tracked chain — that would
    // become an unhandled rejection, the exact failure mode this library exists
    // to prevent.
    console.error(`[fire-forget] ${hook} hook threw`, callbackErr);
  }
}

export function createTracker(opts: TrackerOptions = {}): Tracker {
  const entries = new Set<Entry>();
  let nextId = 0;

  function fire<T>(input: FireInput<T>, fireOpts: FireOptions = {}): void {
    const startedAt = Date.now();
    const perfStart = performance.now();
    const meta: TaskMeta = {
      id: nextId++,
      startedAt,
      ...(fireOpts.label !== undefined ? { label: fireOpts.label } : {}),
    };

    safeCall(() => opts.onStart?.(meta), 'onStart');

    // Only allocate an AbortController when a signal is actually wired up:
    // - thunk inputs receive the signal as an argument
    // - timeoutMs needs the controller to abort on timer fire
    // Plain `Promise<T>` inputs with no timeout never use a signal — skip the
    // allocation, since drain({ abortOnTimeout: true }) on them is a no-op anyway.
    let controller: AbortController | undefined;
    let base: Promise<T>;
    if (typeof input === 'function') {
      controller = new AbortController();
      try {
        base = (input as (s: AbortSignal) => Promise<T>)(controller.signal);
      } catch (err) {
        base = Promise.reject(err);
      }
    } else {
      base = input;
    }
    if (fireOpts.timeoutMs !== undefined && controller === undefined) {
      controller = new AbortController();
    }

    const work =
      fireOpts.timeoutMs !== undefined
        ? withTimeout(base, fireOpts.timeoutMs, controller)
        : base;

    const tracked = work
      .catch((err: unknown) => {
        if (err instanceof TimeoutError) {
          meta.timedOut = true;
        }
        const handler = opts.onError ?? defaultErrorHandler;
        safeCall(() => handler(err, meta), 'onError');
      })
      .finally(() => {
        meta.durationMs = performance.now() - perfStart;
        safeCall(() => opts.onSettle?.(meta), 'onSettle');
        entries.delete(entry);
      });

    const entry: Entry = { promise: tracked, controller };
    entries.add(entry);
  }

  /**
   * Wait for every in-flight task to settle.
   *
   * Note on counts: when `timedOut === true`, `drained` and `remaining` are read
   * after the awaits complete. A task may settle between the timer firing and
   * the counts being captured, so `drained` can be very slightly higher than
   * the count at the exact moment the timer fired. This is informational, not
   * a correctness issue — tasks that beat the deadline still ran to completion.
   */
  async function drain(drainOpts: DrainOptions = {}): Promise<DrainResult> {
    const snapshot = [...entries];
    const total = snapshot.length;
    const all = Promise.allSettled(snapshot.map((e) => e.promise));

    if (drainOpts.timeoutMs === undefined) {
      await all;
      return { drained: total, remaining: 0, timedOut: false };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race<boolean>([
      all.then(() => false),
      new Promise<true>((resolve) => {
        timer = setTimeout(() => resolve(true), drainOpts.timeoutMs);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);

    if (timedOut && drainOpts.abortOnTimeout) {
      for (const e of entries) e.controller?.abort();
      // Grace tick for signal-aware tasks to settle after abort.
      // Plain promises that ignore the signal stay in `remaining`.
      await Promise.race([
        all,
        new Promise<void>((resolve) => setTimeout(resolve, ABORT_GRACE_MS)),
      ]);
    }

    return {
      drained: total - entries.size,
      remaining: entries.size,
      timedOut,
    };
  }

  return { fire, drain, inflight: () => entries.size };
}
