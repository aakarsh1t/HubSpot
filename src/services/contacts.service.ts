import type { Logger } from 'pino';
import { DEFAULT_CONTACT_PROPERTIES, CONTACT_TO_OBJECT_TYPE_ID, HUBSPOT_DEFINED } from './association-types.js';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import type {
  BatchOutcome,
  CrmObject,
  CrmPage,
  PropertyBag,
} from '../types/crm.types.js';
import type {
  BatchCreateContactsInput,
  BatchReadContactsInput,
  BatchUpdateContactsInput,
  CreateContactInput,
  ListContactsInput,
  SearchContactsInput,
  UpdateContactInput,
} from '../schemas/contact.schema.js';

const CONTACTS_BASE = '/crm/v3/objects/contacts';

/** Raw shape of a CRM object as returned by HubSpot. */
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
  readonly numErrors?: number;
}

export interface ContactsServiceDependencies {
  readonly client: HubSpotClient;
  readonly logger: Logger;
}

/**
 * All HubSpot Contacts API behaviour, expressed in domain terms.
 *
 * Deliberately free of MCP concepts. The tools in `src/tools/crm/` are thin
 * adapters over these methods, which means every operation here is unit
 * testable against a faked HubSpot client and could be reused by a REST
 * controller or a queue worker without modification.
 *
 * Idempotency is tracked per call: reads and PATCH/DELETE-by-id are safe to
 * replay and are left retryable, while creates and merges are marked
 * `retryable: false` so a transient 503 can never silently produce duplicate
 * records.
 */
export class ContactsService {
  private readonly client: HubSpotClient;
  private readonly logger: Logger;

  constructor(deps: ContactsServiceDependencies) {
    this.client = deps.client;
    this.logger = deps.logger.child({ component: 'contacts-service' });
  }

  // ------------------------------------------------------------------ create

  /**
   * Creates a contact.
   *
   * @example
   * ```ts
   * await contacts.create({
   *   properties: { email: 'jane@acme.com', firstname: 'Jane', lastname: 'Doe' },
   *   associations: [{ toObjectType: 'companies', toObjectId: '7801' }],
   * });
   * ```
   *
   * @throws {ValidationError} when HubSpot rejects the property set, or when a
   *   contact with the same email already exists (HubSpot returns 409).
   */
  async create(input: CreateContactInput): Promise<CrmObject> {
    const body: Record<string, unknown> = { properties: normalizeProperties(input.properties) };

    if (input.associations !== undefined && input.associations.length > 0) {
      body['associations'] = input.associations.map((association) => ({
        to: { id: association.toObjectId },
        types: [
          {
            associationCategory: HUBSPOT_DEFINED,
            associationTypeId: CONTACT_TO_OBJECT_TYPE_ID[association.toObjectType],
          },
        ],
      }));
    }

    const response = await this.client.request<RawCrmObject>({
      method: 'POST',
      path: CONTACTS_BASE,
      body,
      // Creating is not idempotent: a replayed request after a timeout would
      // produce a duplicate contact.
      retryable: false,
    });

    this.logger.info({ contactId: response.data.id }, 'Created contact.');
    return toCrmObject(response.data);
  }

  // ------------------------------------------------------------------ update

  /**
   * Updates properties on an existing contact.
   *
   * PATCH semantics: omitted properties are left untouched. Sending `null`
   * clears a property.
   */
  async update(input: UpdateContactInput): Promise<CrmObject> {
    const response = await this.client.request<RawCrmObject>({
      method: 'PATCH',
      path: `${CONTACTS_BASE}/${encodeURIComponent(input.contactId)}`,
      body: { properties: normalizeProperties(input.properties) },
      // PATCH with an explicit id is idempotent, so a retry is safe.
      retryable: true,
    });

    this.logger.info({ contactId: input.contactId }, 'Updated contact.');
    return toCrmObject(response.data);
  }

  // -------------------------------------------------------------------- read

  /**
   * Reads a contact by record ID.
   *
   * @param archived pass true to read a soft-deleted record (90-day window).
   */
  async getById(options: {
    readonly contactId: string;
    readonly properties?: readonly string[] | undefined;
    readonly associations?: readonly string[] | undefined;
    readonly archived?: boolean;
  }): Promise<CrmObject & { associations: Record<string, string[]> }> {
    const query: Record<string, string> = {
      properties: (options.properties ?? DEFAULT_CONTACT_PROPERTIES).join(','),
    };

    if (options.associations !== undefined && options.associations.length > 0) {
      query['associations'] = options.associations.join(',');
    }
    if (options.archived === true) {
      query['archived'] = 'true';
    }

    const response = await this.client.request<RawCrmObject>({
      method: 'GET',
      path: `${CONTACTS_BASE}/${encodeURIComponent(options.contactId)}`,
      query,
    });

    return {
      ...toCrmObject(response.data),
      associations: extractAssociations(response.data),
    };
  }

  /**
   * Reads a contact by email address.
   *
   * Uses `idProperty=email`, HubSpot's alternate-key lookup, rather than a
   * search request — it is a single indexed read instead of a query, so it is
   * both faster and not subject to the search API's separate rate limit.
   */
  async getByEmail(options: {
    readonly email: string;
    readonly properties?: readonly string[] | undefined;
  }): Promise<CrmObject> {
    try {
      const response = await this.client.request<RawCrmObject>({
        method: 'GET',
        path: `${CONTACTS_BASE}/${encodeURIComponent(options.email)}`,
        query: {
          idProperty: 'email',
          properties: (options.properties ?? DEFAULT_CONTACT_PROPERTIES).join(','),
        },
      });

      return toCrmObject(response.data);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundError(`No HubSpot contact exists with the email address "${options.email}".`);
      }
      throw error;
    }
  }

  /** Lists contacts in record order. Use `search` when criteria are needed. */
  async list(input: ListContactsInput): Promise<CrmPage<CrmObject>> {
    const query: Record<string, string | number | boolean> = {
      limit: input.limit,
      properties: (input.properties ?? DEFAULT_CONTACT_PROPERTIES).join(','),
      archived: input.archived,
    };

    if (input.after !== undefined) {
      query['after'] = input.after;
    }

    const response = await this.client.request<RawPage>({
      method: 'GET',
      path: CONTACTS_BASE,
      query,
    });

    return toPage(response.data);
  }

  // ------------------------------------------------------------------ search

  /**
   * Searches contacts with filter groups, free-text query, and sorting.
   *
   * Filter groups are OR-ed; filters inside a group are AND-ed. The schema has
   * already enforced HubSpot's 5-group / 6-filter / 18-total limits.
   *
   * @example
   * ```ts
   * await contacts.search({
   *   filterGroups: [{ filters: [
   *     { propertyName: 'lifecyclestage', operator: 'EQ', value: 'lead' },
   *     { propertyName: 'createdate', operator: 'GTE', value: '2026-01-01' },
   *   ]}],
   *   sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
   *   limit: 50,
   * });
   * ```
   */
  async search(input: SearchContactsInput): Promise<CrmPage<CrmObject>> {
    const body: Record<string, unknown> = {
      limit: input.limit,
      properties: input.properties ?? DEFAULT_CONTACT_PROPERTIES,
    };

    if (input.query !== undefined) {
      body['query'] = input.query;
    }
    if (input.after !== undefined) {
      body['after'] = input.after;
    }
    if (input.sorts !== undefined && input.sorts.length > 0) {
      body['sorts'] = input.sorts;
    }
    if (input.filterGroups !== undefined && input.filterGroups.length > 0) {
      body['filterGroups'] = input.filterGroups.map((group) => ({
        filters: group.filters.map(toHubSpotFilter),
      }));
    }

    const response = await this.client.request<RawPage>({
      method: 'POST',
      path: `${CONTACTS_BASE}/search`,
      body,
      // A search is a read despite using POST, so replaying it is harmless.
      retryable: true,
    });

    return toPage(response.data);
  }

  // ------------------------------------------------------------- destructive

  /**
   * Archives (soft-deletes) a contact.
   *
   * Recoverable through the HubSpot UI for 90 days, and readable via
   * `getById({ archived: true })` during that window.
   */
  async archive(contactId: string): Promise<void> {
    await this.client.request<null>({
      method: 'DELETE',
      path: `${CONTACTS_BASE}/${encodeURIComponent(contactId)}`,
      // A replayed DELETE would 404 after succeeding, which reads as a failure.
      retryable: false,
    });

    this.logger.warn({ contactId }, 'Archived contact.');
  }

  /**
   * Permanently and irreversibly deletes a contact (GDPR erasure).
   *
   * Unlike `archive`, nothing survives: the record cannot be recovered by
   * HubSpot support, and the email address is added to a blocklist that
   * prevents it being re-added to the portal.
   */
  async deletePermanently(contactId: string): Promise<void> {
    await this.client.request<null>({
      method: 'POST',
      path: `${CONTACTS_BASE}/gdpr-delete`,
      body: { objectId: contactId },
      retryable: false,
    });

    this.logger.warn({ contactId }, 'Permanently deleted contact (GDPR erasure).');
  }

  /**
   * Merges one contact into another.
   *
   * The primary record survives and keeps its ID; its property values win on
   * conflict. HubSpot processes the merge asynchronously, so a success
   * response means "accepted", not "already applied".
   */
  async merge(primaryContactId: string, contactIdToMerge: string): Promise<CrmObject> {
    const response = await this.client.request<RawCrmObject>({
      method: 'POST',
      path: `${CONTACTS_BASE}/merge`,
      body: { primaryObjectId: primaryContactId, objectIdToMerge: contactIdToMerge },
      retryable: false,
    });

    this.logger.warn({ primaryContactId, contactIdToMerge }, 'Merged contacts.');
    return toCrmObject(response.data);
  }

  /**
   * Recreates a contact from its archived snapshot.
   *
   * HubSpot exposes **no un-archive endpoint** — restoring in place is only
   * possible through the UI recycle bin. The closest programmatic recovery is
   * to read the archived record (readable for 90 days) and create a new
   * contact from its properties. The result is a *new* record with a *new* ID;
   * associations, engagements, and timeline history do not come back.
   *
   * Callers must surface that distinction to the user rather than reporting a
   * plain "restored".
   */
  async recreateFromArchive(options: {
    readonly contactId: string;
    readonly properties?: readonly string[] | undefined;
  }): Promise<{ readonly created: CrmObject; readonly sourceProperties: Record<string, string | null> }> {
    const archived = await this.getById({
      contactId: options.contactId,
      properties: options.properties ?? DEFAULT_CONTACT_PROPERTIES,
      archived: true,
    });

    // Strip HubSpot-managed fields; they are read-only on create and would be
    // rejected or silently ignored.
    const restorable: PropertyBag = {};
    for (const [key, value] of Object.entries(archived.properties)) {
      if (value !== null && value !== '' && !READ_ONLY_PROPERTIES.has(key)) {
        restorable[key] = value;
      }
    }

    if (Object.keys(restorable).length === 0) {
      throw new ValidationError(
        `Archived contact ${options.contactId} has no restorable properties. ` +
          'It may have been permanently deleted, or archived more than 90 days ago.'
      );
    }

    const created = await this.create({ properties: restorable });

    this.logger.warn(
      { archivedContactId: options.contactId, newContactId: created.id },
      'Recreated contact from archived snapshot as a new record.'
    );

    return { created, sourceProperties: archived.properties };
  }

  // ------------------------------------------------------------------- batch

  /** Creates up to 100 contacts in one request. */
  async batchCreate(input: BatchCreateContactsInput): Promise<BatchOutcome<CrmObject>> {
    const response = await this.client.request<RawBatchResponse>({
      method: 'POST',
      path: `${CONTACTS_BASE}/batch/create`,
      body: {
        inputs: input.contacts.map((contact) => ({
          properties: normalizeProperties(contact.properties),
        })),
      },
      retryable: false,
    });

    return toBatchOutcome(response.data, input.contacts.length);
  }

  /** Updates up to 100 contacts in one request. */
  async batchUpdate(input: BatchUpdateContactsInput): Promise<BatchOutcome<CrmObject>> {
    const response = await this.client.request<RawBatchResponse>({
      method: 'POST',
      path: `${CONTACTS_BASE}/batch/update`,
      body: {
        inputs: input.contacts.map((contact) => ({
          id: contact.contactId,
          properties: normalizeProperties(contact.properties),
        })),
      },
      retryable: true,
    });

    return toBatchOutcome(response.data, input.contacts.length);
  }

  /** Archives up to 100 contacts in one request. Returns 204 with no body. */
  async batchArchive(contactIds: readonly string[]): Promise<number> {
    await this.client.request<null>({
      method: 'POST',
      path: `${CONTACTS_BASE}/batch/archive`,
      body: { inputs: contactIds.map((id) => ({ id })) },
      retryable: false,
    });

    this.logger.warn({ count: contactIds.length }, 'Batch archived contacts.');
    return contactIds.length;
  }

  /** Reads up to 100 contacts by ID or email in one request. */
  async batchRead(input: BatchReadContactsInput): Promise<BatchOutcome<CrmObject>> {
    const body: Record<string, unknown> = {
      properties: input.properties ?? DEFAULT_CONTACT_PROPERTIES,
      inputs: input.contactIds.map((id) => ({ id })),
    };

    if (input.idProperty === 'email') {
      body['idProperty'] = 'email';
    }

    const response = await this.client.request<RawBatchResponse>({
      method: 'POST',
      path: `${CONTACTS_BASE}/batch/read`,
      body,
      retryable: true,
    });

    return toBatchOutcome(response.data, input.contactIds.length);
  }
}

/**
 * HubSpot-managed properties that cannot be set on create.
 * Attempting to write them produces a 400 that is easy to misdiagnose.
 */
const READ_ONLY_PROPERTIES = new Set([
  'hs_object_id',
  'createdate',
  'lastmodifieddate',
  'hs_lastmodifieddate',
  'hs_createdate',
  'hs_all_owner_ids',
  'hs_all_team_ids',
  'hs_object_source',
  'hs_object_source_id',
  'hs_object_source_label',
]);

/**
 * HubSpot stores every property as a string. Coercing here — rather than at
 * each call site — means a caller can pass a number or boolean naturally.
 */
function normalizeProperties(properties: PropertyBag): Record<string, string | null> {
  const normalized: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(properties)) {
    normalized[key] = value === null ? null : String(value);
  }

  return normalized;
}

function toHubSpotFilter(filter: {
  propertyName: string;
  operator: string;
  value?: string | number | boolean | undefined;
  values?: (string | number)[] | undefined;
  highValue?: string | number | undefined;
}): Record<string, unknown> {
  const mapped: Record<string, unknown> = {
    propertyName: filter.propertyName,
    operator: filter.operator,
  };

  if (filter.value !== undefined) mapped['value'] = filter.value;
  if (filter.values !== undefined) mapped['values'] = filter.values;
  if (filter.highValue !== undefined) mapped['highValue'] = filter.highValue;

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
 * Normalises a HubSpot batch response.
 *
 * HubSpot answers a partially-successful batch with HTTP 207 and a body
 * containing both results and errors. Surfacing `succeeded`/`failed` counts
 * explicitly stops a caller from reading a 207 as a clean success — the most
 * common way batch imports lose records silently.
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

  return {
    status,
    results,
    errors,
    requested,
    succeeded: results.length,
    failed,
  };
}
