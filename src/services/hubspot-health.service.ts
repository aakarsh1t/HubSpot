import type { Logger } from 'pino';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import { type AppError, AppErrorCodes, normalizeError } from '../utils/errors.js';
import type { HubSpotTokenProvider } from '../types/auth.types.js';
import type {
  ConnectionStatus,
  HubSpotAccountDetails,
  HubSpotConnectionReport,
  HubSpotPingResult,
} from '../types/hubspot.types.js';

/**
 * HubSpot's account-details endpoint.
 *
 * Chosen as the probe because it is cheap, read-only, portal-scoped, and
 * returns identity information that proves *which* portal the credential
 * actually reaches — a connection test that only proves "some token worked"
 * is close to useless when an integration is pointed at the wrong portal.
 */
const ACCOUNT_DETAILS_PATH = '/account-info/v3/details';

export interface HubSpotHealthServiceDependencies {
  readonly client: HubSpotClient;
  readonly tokenProvider: HubSpotTokenProvider;
  readonly logger: Logger;
}

/**
 * Connectivity and credential diagnostics.
 *
 * Deliberately free of MCP and HTTP concepts: the same methods back the
 * `/ping/hubspot` REST endpoint and the `hubspot_test_connection` MCP tool, so
 * the two can never disagree about what "healthy" means.
 */
export class HubSpotHealthService {
  private readonly client: HubSpotClient;
  private readonly tokenProvider: HubSpotTokenProvider;
  private readonly logger: Logger;

  constructor(deps: HubSpotHealthServiceDependencies) {
    this.client = deps.client;
    this.tokenProvider = deps.tokenProvider;
    this.logger = deps.logger.child({ component: 'hubspot-health' });
  }

  /**
   * Cheap liveness probe. Never throws — a monitoring endpoint that throws
   * tells you less than one that reports a failure.
   */
  async ping(signal?: AbortSignal): Promise<HubSpotPingResult> {
    const startedAt = Date.now();

    try {
      const details = await this.fetchAccountDetails(signal);

      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        portalId: details.portalId,
        message: `Connected to HubSpot portal ${details.portalId}.`,
      };
    } catch (caught) {
      const error = normalizeError(caught);
      this.logger.warn(
        { errorCode: error.code, errorMessage: error.message },
        'HubSpot ping failed.'
      );

      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        portalId: null,
        message: error.publicMessage,
      };
    }
  }

  /**
   * Full credential + connectivity report.
   *
   * Distinguishes *why* a connection is unhealthy, because the remediation
   * differs completely: `unauthorized` means fix the token or its scopes,
   * `unreachable` means HubSpot or the network is down and there is nothing to
   * fix on our side.
   */
  async testConnection(signal?: AbortSignal): Promise<HubSpotConnectionReport> {
    const startedAt = Date.now();
    const descriptor = await this.tokenProvider.describe();

    try {
      const details = await this.fetchAccountDetails(signal);
      const latencyMs = Date.now() - startedAt;

      return {
        status: 'connected',
        authMode: descriptor.mode,
        latencyMs,
        checkedAt: new Date().toISOString(),
        portalId: details.portalId,
        accountType: details.accountType,
        uiDomain: details.uiDomain,
        dataHostingLocation: details.dataHostingLocation,
        scopeCount: descriptor.scopeCount,
        tokenExpiresAt: descriptor.expiresAt,
        message: `Successfully connected to HubSpot portal ${details.portalId} using ${descriptor.mode} authentication.`,
      };
    } catch (caught) {
      const error = normalizeError(caught);

      this.logger.error(
        { errorCode: error.code, errorMessage: error.message, authMode: descriptor.mode },
        'HubSpot connection test failed.'
      );

      return {
        status: classifyFailure(error),
        authMode: descriptor.mode,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
        portalId: null,
        accountType: null,
        uiDomain: null,
        dataHostingLocation: null,
        scopeCount: descriptor.scopeCount,
        tokenExpiresAt: descriptor.expiresAt,
        message: buildRemediationMessage(error),
      };
    }
  }

  private async fetchAccountDetails(signal?: AbortSignal): Promise<HubSpotAccountDetails> {
    const response = await this.client.request<RawAccountDetails>({
      method: 'GET',
      path: ACCOUNT_DETAILS_PATH,
      // A health probe must not sit behind a long retry chain; if HubSpot is
      // slow, the useful answer is "degraded", delivered promptly.
      timeoutMs: 10_000,
      ...(signal === undefined ? {} : { signal }),
    });

    const raw = response.data;

    return {
      portalId: raw.portalId,
      accountType: raw.accountType ?? null,
      timeZone: raw.timeZone ?? null,
      companyCurrency: raw.companyCurrency ?? null,
      uiDomain: raw.uiDomain ?? null,
      dataHostingLocation: raw.dataHostingLocation ?? null,
    };
  }
}

interface RawAccountDetails {
  readonly portalId: number;
  readonly accountType?: string;
  readonly timeZone?: string;
  readonly companyCurrency?: string;
  readonly uiDomain?: string;
  readonly dataHostingLocation?: string;
}

function classifyFailure(error: AppError): ConnectionStatus {
  switch (error.code) {
    case AppErrorCodes.AUTHENTICATION_FAILED:
    case AppErrorCodes.AUTHORIZATION_FAILED:
      return 'unauthorized';

    case AppErrorCodes.UPSTREAM_UNAVAILABLE:
    case AppErrorCodes.CIRCUIT_OPEN:
      return 'unreachable';

    case AppErrorCodes.TIMEOUT:
    case AppErrorCodes.HUBSPOT_RATE_LIMITED:
    case AppErrorCodes.RATE_LIMITED:
      return 'degraded';

    default:
      return 'unreachable';
  }
}

/**
 * Turns a failure into an instruction.
 *
 * These messages are read by an agent and relayed to a business user in
 * Copilot Studio, so "401 Unauthorized" is worthless — what they need is the
 * next action to take.
 */
function buildRemediationMessage(error: AppError): string {
  switch (error.code) {
    case AppErrorCodes.AUTHENTICATION_FAILED:
      return `HubSpot rejected the configured credentials. Verify HUBSPOT_PRIVATE_APP_TOKEN (or the OAuth refresh token) is current and has not been revoked. Details: ${error.publicMessage}`;

    case AppErrorCodes.AUTHORIZATION_FAILED:
      return `The HubSpot credential is valid but lacks a required scope. Grant the "oauth" scope (and any object scopes you need) to the app, then reinstall it. Details: ${error.publicMessage}`;

    case AppErrorCodes.CIRCUIT_OPEN:
      return 'The circuit breaker is open after repeated HubSpot failures. The server will retry automatically once the cool-down elapses.';

    case AppErrorCodes.HUBSPOT_RATE_LIMITED:
      return 'HubSpot is rate limiting this portal. Reduce request volume or raise the portal API limit.';

    case AppErrorCodes.TIMEOUT:
      return 'The HubSpot API did not respond before the configured timeout. Check HubSpot status and network egress from the App Service.';

    case AppErrorCodes.UPSTREAM_UNAVAILABLE:
      return `HubSpot could not be reached. Confirm outbound network access from the App Service. Details: ${error.publicMessage}`;

    default:
      return error.publicMessage;
  }
}
