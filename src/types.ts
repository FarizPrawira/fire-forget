export interface TaskMeta {
  id: number;
  label?: string;
  startedAt: number;
  durationMs?: number;
  timedOut?: boolean;
}

export interface TrackerOptions {
  onError?: (err: unknown, meta: TaskMeta) => void;
  onStart?: (meta: TaskMeta) => void;
  onSettle?: (meta: TaskMeta) => void;
}

export interface FireOptions {
  timeoutMs?: number;
  label?: string;
}

export interface DrainOptions {
  timeoutMs?: number;
  abortOnTimeout?: boolean;
}

export interface DrainResult {
  drained: number;
  remaining: number;
  timedOut: boolean;
}

export type FireInput<T> =
  | Promise<T>
  | (() => Promise<T>)
  | ((signal: AbortSignal) => Promise<T>);

export interface Tracker {
  fire<T>(input: FireInput<T>, opts?: FireOptions): void;
  drain(opts?: DrainOptions): Promise<DrainResult>;
  inflight(): number;
}

export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
  constructor(ms: number) {
    super(`Task timed out after ${ms}ms`);
  }
}
