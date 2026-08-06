import type { Logger } from 'pino';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import { ValidationError } from '../utils/errors.js';
import type {
  BatchOutcome,
  CrmObject,
  CrmObjectType,
  CrmPage,
  PropertyBag,
} from '../types/crm.types.js';

interface RawCrmObject {
  readonly id: string;
  readonly properties?: Record<string, string | null>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly archived?: boolean;
  readonly associations?: Record<string, { results?: { id: string; type: string }[] }>;
}

interface RawPage {
  readonly results?: RawCrmObject[];
  readonly total?: number;
  readonly paging?: { readonly next?: { readonly after?: string } };
}

interface RawBatchResponse {
  readonly status?: string;
  readonly results?: RawCrmObject[];
  readonly errors?: {
    readonly message?: string;
    readonly category?: string;
    readonly context?: Record<string, unknown>;
  }[];
}

export interface SearchFilterInput {
  readonly propertyName: string;
  readonly operator: string;
  readonly value?: string | number | boolean | undefined;
  readonly values?: (string | number)[] | undefined;
  readonly highValue?: string | number | undefined;
}

export interface SearchInput {
  readonly query?: string | undefined;
  readonly filterGroups?: readonly { readonly filters: readonly SearchFilterInput[] }[] | undefined;
  readonly sorts?:
    readonly { readonly propertyName: string; readonly direction: string }[] | undefined;
  readonly properties?: readonly string[] | undefined;
  readonly limit: number;
  readonly after?: string | undefined;
}

export interface CrmObjectServiceOptions {
  readonly objectType: CrmObjectType;
  readonly client: HubSpotClient;
  readonly logger: Logger;
  readonly defaultProperties: readonly string[];
  /**
   * HubSpot-managed properties rejected (or silently ignored) on create.
   * Stripped automatically by `recreateFromArchive` so the one working
   * recovery path for an archived record does not immediately fail by
   * echoing read-only fields back to HubSpot.
   */
  readonly readOnlyProperties: ReadonlySet<string>;
}

/**
 * Generic HubSpot CRM object operations: create, update, read, list, search,
 * archive, permanent delete, merge, and batch variants of each — everything
 * that is identical across contacts, companies, and deals because HubSpot's
 * v3 Objects API is itself one generic surface parameterized by object type.
 *
 * `ContactsService`, `CompaniesService`, and `DealsService` each hold one of
 * these, configured for their object type, and add only what is genuinely
 * object-specific on top (email lookup for contacts; stage/pipeline
 * operations for deals). That composition is what "don't duplicate code"
 * means concretely here — one implementation of create/search/batch/merge/
 * restore, not three near-identical copies.
 */
export class CrmObjectService {
  private readonly objectType: CrmObjectType;
  private readonly client: HubSpotClient;
  private readonly logger: Logger;
  private readonly defaultProperties: readonly string[];
  private readonly readOnlyProperties: ReadonlySet<string>;
  private readonly basePath: string;

  constructor(options: CrmObjectServiceOptions) {
    this.objectType = options.objectType;
    this.client = options.client;
    this.logger = options.logger.child({ component: `${options.objectType}-service` });
    this.defaultProperties = options.defaultProperties;
    this.readOnlyProperties = options.readOnlyProperties;
    this.basePath = `/crm/v3/objects/${options.objectType}`;
  }

  /** Creates a record. Not idempotent — the underlying request is non-retryable. */
  async create(
    properties: PropertyBag,
    associations?: readonly { readonly toObjectId: string; readonly associationTypeId: number }[]
  ): Promise<CrmObject> {
    const body: Record<string, unknown> = { properties: normalizeProperties(properties) };

    if (associations !== undefined && associations.length > 0) {
      body.associations = associations.map((association) => ({
        to: { id: association.toObjectId },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: association.associationTypeId,
          },
        ],
      }));
    }

    const response = await this.client.request<RawCrmObject>({
      method: 'POST',
      path: this.basePath,
      body,
      retryable: false,
    });

    this.logger.info({ id: response.data.id }, `Created ${this.objectType} record.`);
    return toCrmObject(response.data);
  }

  /** PATCH-updates a record by ID. Idempotent — safe to retry. */
  async update(id: string, properties: PropertyBag): Promise<CrmObject> {
    const response = await this.client.request<RawCrmObject>({
      method: 'PATCH',
      path: `${this.basePath}/${encodeURIComponent(id)}`,
      body: { properties: normalizeProperties(properties) },
      retryable: true,
    });

    this.logger.info({ id }, `Updated ${this.objectType} record.`);
    return toCrmObject(response.data);
  }

  async getById(options: {
    readonly id: string;
    readonly properties?: readonly string[] | undefined;
    readonly associations?: readonly string[] | undefined;
    readonly archived?: boolean;
  }): Promise<CrmObject & { associations: Record<string, string[]> }> {
    const query: Record<string, string> = {
      properties: (options.properties ?? this.defaultProperties).join(','),
    };

    if (options.associations !== undefined && options.associations.length > 0) {
      query.associations = options.associations.join(',');
    }
    if (options.archived === true) {
      query.archived = 'true';
    }

    const response = await this.client.request<RawCrmObject>({
      method: 'GET',
      path: `${this.basePath}/${encodeURIComponent(options.id)}`,
      query,
    });

    return { ...toCrmObject(response.data), associations: extractAssociations(response.data) };
  }

  /**
   * Reads a record by an alternate unique-value property (e.g. a contact's
   * email). HubSpot's single-object `idProperty` lookup is documented and
   * reliable for contacts+email; it is community-reported as unreliable for
   * companies+domain, which is why `CompaniesService` does not expose an
   * equivalent method and points callers at search instead.
   */
  async getByAlternateId(options: {
    readonly value: string;
    readonly idProperty: string;
    readonly properties?: readonly string[] | undefined;
  }): Promise<CrmObject> {
    const response = await this.client.request<RawCrmObject>({
      method: 'GET',
      path: `${this.basePath}/${encodeURIComponent(options.value)}`,
      query: {
        idProperty: options.idProperty,
        properties: (options.properties ?? this.defaultProperties).join(','),
      },
    });

    return toCrmObject(response.data);
  }

  async list(options: {
    readonly limit: number;
    readonly after?: string | undefined;
    readonly properties?: readonly string[] | undefined;
    readonly archived?: boolean;
  }): Promise<CrmPage<CrmObject>> {
    const query: Record<string, string | number | boolean> = {
      limit: options.limit,
      properties: (options.properties ?? this.defaultProperties).join(','),
      archived: options.archived ?? false,
    };

    if (options.after !== undefined) {
      query.after = options.after;
    }

    const response = await this.client.request<RawPage>({
      method: 'GET',
      path: this.basePath,
      query,
    });
    return toPage(response.data);
  }

  /**
   * Filtered/free-text search. A POST despite being a read, so it stays
   * `retryable: true` — replaying it is harmless.
   */
  async search(input: SearchInput): Promise<CrmPage<CrmObject>> {
    const body: Record<string, unknown> = {
      limit: input.limit,
      properties: input.properties ?? this.defaultProperties,
    };

    if (input.query !== undefined) body.query = input.query;
    if (input.after !== undefined) body.after = input.after;
    if (input.sorts !== undefined && input.sorts.length > 0) body.sorts = input.sorts;
    if (input.filterGroups !== undefined && input.filterGroups.length > 0) {
      body.filterGroups = input.filterGroups.map((group) => ({
        filters: group.filters.map(toHubSpotFilter),
      }));
    }

    const response = await this.client.request<RawPage>({
      method: 'POST',
      path: `${this.basePath}/search`,
      body,
      retryable: true,
    });

    return toPage(response.data);
  }

  /** Archives (soft-deletes) a record. Recoverable via the HubSpot UI for 90 days. */
  async archive(id: string): Promise<void> {
    await this.client.request<null>({
      method: 'DELETE',
      path: `${this.basePath}/${encodeURIComponent(id)}`,
      retryable: false,
    });
    this.logger.warn({ id }, `Archived ${this.objectType} record.`);
  }

  /** Permanently and irreversibly deletes a record (GDPR erasure). */
  async deletePermanently(id: string): Promise<void> {
    await this.client.request<null>({
      method: 'POST',
      path: `${this.basePath}/gdpr-delete`,
      body: { objectId: id },
      retryable: false,
    });
    this.logger.warn({ id }, `Permanently deleted ${this.objectType} record (GDPR erasure).`);
  }

  /** Merges one record into another. The primary survives and keeps its ID. */
  async merge(primaryId: string, idToMerge: string): Promise<CrmObject> {
    const response = await this.client.request<RawCrmObject>({
      method: 'POST',
      path: `${this.basePath}/merge`,
      body: { primaryObjectId: primaryId, objectIdToMerge: idToMerge },
      retryable: false,
    });

    this.logger.warn({ primaryId, idToMerge }, `Merged ${this.objectType} records.`);
    return toCrmObject(response.data);
  }

  /**
   * Recreates a record from its archived snapshot.
   *
   * HubSpot exposes **no un-archive endpoint** for any object type — this is
   * the only programmatic recovery available. See `restore-*.tool.ts` for the
   * full explanation surfaced to callers; this method only performs the
   * read-then-create and reports what was actually recovered.
   */
  async recreateFromArchive(options: {
    readonly id: string;
    readonly properties?: readonly string[] | undefined;
  }): Promise<{
    readonly created: CrmObject;
    readonly sourceProperties: Record<string, string | null>;
  }> {
    const archived = await this.getById({
      id: options.id,
      properties: options.properties ?? this.defaultProperties,
      archived: true,
    });

    const restorable: PropertyBag = {};
    for (const [key, value] of Object.entries(archived.properties)) {
      if (value !== null && value !== '' && !this.readOnlyProperties.has(key)) {
        restorable[key] = value;
      }
    }

    if (Object.keys(restorable).length === 0) {
      throw new ValidationError(
        `Archived ${this.objectType} record ${options.id} has no restorable properties. ` +
          'It may have been permanently deleted, or archived more than 90 days ago.'
      );
    }

    const created = await this.create(restorable);

    this.logger.warn(
      { archivedId: options.id, newId: created.id },
      `Recreated ${this.objectType} record from archived snapshot as a new record.`
    );

    return { created, sourceProperties: archived.properties };
  }

  async batchCreate(
    inputs: readonly { readonly properties: PropertyBag }[]
  ): Promise<BatchOutcome<CrmObject>> {
    const response = await this.client.request<RawBatchResponse>({
      method: 'POST',
      path: `${this.basePath}/batch/create`,
      body: {
        inputs: inputs.map((input) => ({ properties: normalizeProperties(input.properties) })),
      },
      retryable: false,
    });

    return toBatchOutcome(response.data, inputs.length);
  }

  async batchUpdate(
    inputs: readonly { readonly id: string; readonly properties: PropertyBag }[]
  ): Promise<BatchOutcome<CrmObject>> {
    const response = await this.client.request<RawBatchResponse>({
      method: 'POST',
      path: `${this.basePath}/batch/update`,
      body: {
        inputs: inputs.map((input) => ({
          id: input.id,
          properties: normalizeProperties(input.properties),
        })),
      },
      retryable: true,
    });

    return toBatchOutcome(response.data, inputs.length);
  }

  /** Archives up to 100 records in one request. HubSpot returns 204 with no body. */
  async batchArchive(ids: readonly string[]): Promise<number> {
    await this.client.request<null>({
      method: 'POST',
      path: `${this.basePath}/batch/archive`,
      body: { inputs: ids.map((id) => ({ id })) },
      retryable: false,
    });

    this.logger.warn({ count: ids.length }, `Batch archived ${this.objectType} records.`);
    return ids.length;
  }

  async batchRead(options: {
    readonly ids: readonly string[];
    readonly idProperty?: string | undefined;
    readonly properties?: readonly string[] | undefined;
  }): Promise<BatchOutcome<CrmObject>> {
    const body: Record<string, unknown> = {
      properties: options.properties ?? this.defaultProperties,
      inputs: options.ids.map((id) => ({ id })),
    };

    if (options.idProperty !== undefined) {
      body.idProperty = options.idProperty;
    }

    const response = await this.client.request<RawBatchResponse>({
      method: 'POST',
      path: `${this.basePath}/batch/read`,
      body,
      retryable: true,
    });

    return toBatchOutcome(response.data, options.ids.length);
  }
}

/** HubSpot stores every property as a string; coerce so callers can pass native types. */
function normalizeProperties(properties: PropertyBag): Record<string, string | null> {
  const normalized: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    normalized[key] = value === null ? null : String(value);
  }
  return normalized;
}

function toHubSpotFilter(filter: SearchFilterInput): Record<string, unknown> {
  const mapped: Record<string, unknown> = {
    propertyName: filter.propertyName,
    operator: filter.operator,
  };
  if (filter.value !== undefined) mapped.value = filter.value;
  if (filter.values !== undefined) mapped.values = filter.values;
  if (filter.highValue !== undefined) mapped.highValue = filter.highValue;
  return mapped;
}

function toCrmObject(raw: RawCrmObject): CrmObject {
  return {
    id: raw.id,
    properties: raw.properties ?? {},
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    archived: raw.archived ?? false,
  };
}

function extractAssociations(raw: RawCrmObject): Record<string, string[]> {
  const associations: Record<string, string[]> = {};
  for (const [objectType, value] of Object.entries(raw.associations ?? {})) {
    associations[objectType] = (value.results ?? []).map((result) => result.id);
  }
  return associations;
}

function toPage(raw: RawPage): CrmPage<CrmObject> {
  return {
    results: (raw.results ?? []).map(toCrmObject),
    after: raw.paging?.next?.after ?? null,
    total: raw.total ?? null,
  };
}

/**
 * Normalises a HubSpot batch response. HubSpot answers a partially-successful
 * batch with HTTP 207 and a body containing both results and errors;
 * surfacing explicit `succeeded`/`failed` counts stops a caller from reading
 * a 207 as a clean success — the most common way batch imports lose records
 * silently.
 */
function toBatchOutcome(raw: RawBatchResponse, requested: number): BatchOutcome<CrmObject> {
  const results = (raw.results ?? []).map(toCrmObject);
  const errors = (raw.errors ?? []).map((error) => ({
    message: error.message ?? 'Unknown batch error.',
    category: error.category ?? null,
    context: error.context ?? null,
  }));

  const failed = errors.length > 0 ? errors.length : Math.max(0, requested - results.length);
  const status: BatchOutcome<CrmObject>['status'] =
    failed === 0 ? 'COMPLETE' : results.length === 0 ? 'ERROR' : 'PARTIAL';

  return { status, results, errors, requested, succeeded: results.length, failed };
}
