import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Ambient per-request correlation data.
 *
 * Threading a `requestId` through every function signature down to the HubSpot
 * client would pollute the entire codebase. `AsyncLocalStorage` gives us the
 * same correlation for free, and unlike a module-level variable it stays
 * correct under concurrency — each in-flight request sees only its own store.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly sessionId: string | null;
  readonly toolName: string | null;
  readonly startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(
  overrides: Partial<Omit<RequestContext, 'startedAt'>> = {}
): RequestContext {
  return {
    requestId: overrides.requestId ?? randomUUID(),
    sessionId: overrides.sessionId ?? null,
    toolName: overrides.toolName ?? null,
    startedAt: Date.now(),
  };
}

/** Runs `fn` with `context` visible to every async descendant of the call. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Returns the active request id, or `'-'` outside a request (e.g. at boot). */
export function getRequestId(): string {
  return storage.getStore()?.requestId ?? '-';
}

/**
 * Derives a child context, e.g. when a tool call begins inside an HTTP request.
 * Keeps the original `requestId` so the whole chain stays correlated.
 */
export function withToolContext(toolName: string, sessionId: string | null): RequestContext {
  const parent = storage.getStore();
  return {
    requestId: parent?.requestId ?? randomUUID(),
    sessionId: sessionId ?? parent?.sessionId ?? null,
    toolName,
    startedAt: Date.now(),
  };
}
