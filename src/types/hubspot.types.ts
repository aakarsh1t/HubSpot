/** Options for a single HubSpot API call, transport-agnostic. */
export interface HubSpotRequestOptions {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Path relative to the API base, e.g. `/account-info/v3/details`. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean>>;
  readonly body?: unknown;
  /** Overrides the configured default for this call only. */
  readonly timeoutMs?: number;
  /** Set false for calls that must never be replayed (non-idempotent writes). */
  readonly retryable?: boolean;
  readonly signal?: AbortSignal;
}

export interface HubSpotResponse<T> {
  readonly status: number;
  readonly data: T;
  /** Round-trip duration including retries, in milliseconds. */
  readonly durationMs: number;
  readonly attempts: number;
}

/** Subset of `GET /account-info/v3/details` that we depend on. */
export interface HubSpotAccountDetails {
  readonly portalId: number;
  readonly accountType: string | null;
  readonly timeZone: string | null;
  readonly companyCurrency: string | null;
  readonly uiDomain: string | null;
  readonly dataHostingLocation: string | null;
}

export type ConnectionStatus = 'connected' | 'degraded' | 'unauthorized' | 'unreachable';

/** Result of an end-to-end credential + connectivity probe. */
export interface HubSpotConnectionReport {
  readonly status: ConnectionStatus;
  readonly authMode: string;
  readonly latencyMs: number;
  readonly checkedAt: string;
  readonly portalId: number | null;
  readonly accountType: string | null;
  readonly uiDomain: string | null;
  readonly dataHostingLocation: string | null;
  readonly scopeCount: number | null;
  readonly tokenExpiresAt: string | null;
  readonly message: string;
}

/** Lightweight liveness probe against HubSpot. */
export interface HubSpotPingResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly checkedAt: string;
  readonly portalId: number | null;
  readonly message: string;
}
