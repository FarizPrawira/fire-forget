import { createTracker } from './tracker.js';
import type {
  DrainOptions,
  DrainResult,
  FireInput,
  FireOptions,
  Tracker,
  TrackerOptions,
} from './types.js';

let defaultTracker: Tracker | undefined;

function ensureDefault(): Tracker {
  if (defaultTracker === undefined) {
    defaultTracker = createTracker();
  }
  return defaultTracker;
}

/**
 * Configure the default singleton's hooks. Must be called before the first
 * `fire()` / `drain()` / `inflight()` — otherwise the default tracker has
 * already been created with no hooks, and configuration is rejected.
 */
export function configureDefault(opts: TrackerOptions): void {
  if (defaultTracker !== undefined) {
    throw new Error(
      '[fire-forget] configureDefault() must be called before the first fire/drain/inflight',
    );
  }
  defaultTracker = createTracker(opts);
}

export function fire<T>(input: FireInput<T>, opts?: FireOptions): void {
  ensureDefault().fire(input, opts);
}

export function drain(opts?: DrainOptions): Promise<DrainResult> {
  return ensureDefault().drain(opts);
}

export function inflight(): number {
  return ensureDefault().inflight();
}
