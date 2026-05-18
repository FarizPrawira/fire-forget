# fire-forget

[![npm version](https://img.shields.io/npm/v/fire-forget.svg)](https://www.npmjs.com/package/fire-forget)
[![npm downloads](https://img.shields.io/npm/dm/fire-forget.svg)](https://www.npmjs.com/package/fire-forget)
![zero dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
![types included](https://img.shields.io/badge/types-included-blue)
[![license MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Tiny, zero-dependency in-flight promise tracker with drain-on-shutdown and `AbortSignal` cancellation.

- Two-call workflow — `fire(promise)` to dispatch, `await drain()` on shutdown
- Drains cleanly on SIGTERM — waits for detached work before the process exits
- Optional per-task timeout — `fire(work, { timeoutMs: 5000 })` rejects on overrun
- `AbortSignal` propagation — `drain({ abortOnTimeout: true })` cancels stragglers
- Hookable for observability — `onStart` / `onSettle` / `onError` with task metadata
- Isolated instances — `createTracker()` for tests or independent workloads
- Zero runtime dependencies, ships with TypeScript types
- Tiny surface area — four functions, one error class

```ts
import { fire, drain, inflight } from 'fire-forget';

// Plain promise — fire and forget. No cancellation possible.
fire(fetch('/analytics', { method: 'POST', body }));

// Signal-aware thunk — cancellable on per-task timeout or drain timeout.
fire((signal) => fetch('/slow', { signal }), { timeoutMs: 5000 });

inflight();
// → 2

// On SIGTERM, wait up to 10s; abort what didn't finish.
await drain({ timeoutMs: 10_000, abortOnTimeout: true });
// → { drained: 1, remaining: 1, timedOut: true }
```

## Install

```sh
npm install fire-forget
# or
pnpm add fire-forget
# or
yarn add fire-forget
# or
bun add fire-forget
```

Both ESM and CommonJS are shipped:

```ts
import { fire, drain } from 'fire-forget';            // ESM / TypeScript
const { fire, drain } = require('fire-forget');       // CommonJS
```

Requires Node ≥ 22.

## Why

Detached promises are easy to start and easy to lose. When the process receives `SIGTERM`, every in-flight `fetch()` you didn't `await` dies mid-write — half-sent analytics, dropped audit logs, partial cache warms.

## API

### `fire(input, opts?)`

Register a detached task. Returns `void` — by design, so you can't accidentally `await` and defeat the purpose.

| Input | Cancellable | What it means |
|---|---|---|
| `Promise<T>` | No | The work is already running; you just hand off the promise. |
| `() => Promise<T>` | No | `fire` invokes the thunk synchronously to start the work. |
| `(signal: AbortSignal) => Promise<T>` | Yes | Same as above, plus a per-task `AbortSignal` for timeouts and drain-abort. |

| Option | Type | Default | Meaning |
|---|---|---|---|
| `timeoutMs` | `number` | none | Reject with `TimeoutError` after N ms. Aborts the signal if present. |
| `label` | `string` | none | Surfaced on `TaskMeta.label` for hook callbacks. |

### `drain(opts?)`

Wait for every in-flight task to settle. Returns `Promise<DrainResult>`.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `timeoutMs` | `number` | wait forever | Give up waiting after N ms. |
| `abortOnTimeout` | `boolean` | `false` | When the drain timer fires, abort the signal on every pending task. Signal-aware tasks settle quickly; plain promises stay in `remaining`. |

```ts
interface DrainResult {
  drained: number;    // tasks that settled within the budget
  remaining: number;  // tasks still pending — only > 0 if timedOut
  timedOut: boolean;
}
```

### `inflight()`

Returns the current count of pending tasks as a `number`.

### `createTracker(opts?)`

Returns an isolated `Tracker` with its own `fire` / `drain` / `inflight`. The module-level exports are bound to a default singleton (no hooks).

| Hook | Signature | Fires when |
|---|---|---|
| `onStart` | `(meta: TaskMeta) => void` | `fire()` is called, after the task is registered. |
| `onSettle` | `(meta: TaskMeta) => void` | A task finishes (success or failure). `meta.durationMs` is set. |
| `onError` | `(err: unknown, meta: TaskMeta) => void` | A task rejects or its per-task timeout fires. Without `onError`, errors log to `console.error`. |

```ts
interface TaskMeta {
  id: number;          // monotonic per tracker, starts at 0
  label?: string;      // from fire(..., { label })
  startedAt: number;   // Date.now() when fire() was called
  durationMs?: number; // set in onSettle
  timedOut?: boolean;  // set in onSettle if per-task timeoutMs fired
}
```

### `configureDefault(opts)`

Install hooks on the default singleton. **Must be called before the first `fire()` / `drain()` / `inflight()`** — otherwise the default tracker has already been created with no hooks and the call throws. Accepts the same `TrackerOptions` as `createTracker`.

```ts
import { configureDefault, fire } from 'fire-forget';

configureDefault({
  onError: (err, meta) => logger.error({ err, meta }, 'detached task failed'),
});

fire(somePromise);
```

### `TimeoutError`

Thrown when a per-task `timeoutMs` elapses. `err.name === 'TimeoutError'`.

## Patterns

**Graceful shutdown with native signals.**

```ts
import { drain } from 'fire-forget';

const shutdown = async () => {
  const result = await drain({ timeoutMs: 10_000, abortOnTimeout: true });
  if (result.timedOut) {
    console.warn('shutdown drain incomplete', { remaining: result.remaining });
  }
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

**Isolated tracker for observability.**

```ts
import { createTracker } from 'fire-forget';

const tracker = createTracker({
  onError:  (err, meta) => logger.error({ err, meta }, 'detached task failed'),
  onStart:  (meta) => metrics.increment('detached.start'),
  onSettle: (meta) => metrics.timing('detached.duration', meta.durationMs),
});

tracker.fire(doWork(), { label: 'cache-warm' });
await tracker.drain();
```

## What's not included

- ❌ Durable retries across process restarts (use `bullmq`, `pg-boss`, `graphile-worker`)
- ❌ HTTP keep-alive connection draining (use `http-terminator`, `stoppable`)
- ❌ Auto-installed signal handlers (wire your own — frameworks vary)
- ❌ Backpressure / max-inflight caps
- ❌ Browser support (Node-only target)

## License

MIT
