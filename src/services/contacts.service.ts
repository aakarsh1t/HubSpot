import type { Logger } from 'pino';
import { getAssociationTypeId } from './association-types.js';
import { CrmObjectService } from './crm-object.service.js';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import { NotFoundError } from '../utils/errors.js';
import type { BatchOutcome, CrmObject, CrmPage } from '../types/crm.types.js';
import type {
  BatchCreateContactsInput,
  BatchReadContactsInput,
  BatchUpdateContactsInput,
  CreateContactInput,
  ListContactsInput,
  SearchContactsInput,
  UpdateContactInput,
} from '../schemas/contact.schema.js';

/**
 * HubSpot-managed properties that cannot be set on create. Attempting to
 * write them produces a 400 that is easy to misdiagnose.
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

const DEFAULT_CONTACT_PROPERTIES: readonly string[] = [
  'email',
  'firstname',
  'lastname',
  'phone',
  'mobilephone',
  'company',
  'jobtitle',
  'website',
  'lifecyclestage',
  'hs_lead_status',
  'hubspot_owner_id',
  'createdate',
  'lastmodifieddate',
];

export interface ContactsServiceDependencies {
  readonly client: HubSpotClient;
  readonly logger: Logger;
}

/**
 * Contact-specific HubSpot behaviour, composed over the generic
 * `CrmObjectService`.
 *
 * Everything that is identical across contacts, companies, and deals — CRUD,
 * search, batch operations, merge, archived-record recovery — lives in
 * `CrmObjectService` and is not reimplemented here. What remains is what is
 * genuinely specific to contacts: the email alternate-key lookup (HubSpot
 * has no equivalent reliable lookup for companies or deals), and the
 * association-shorthand used when creating a contact with associations
 * attached.
 */
export class ContactsService {
  private readonly generic: CrmObjectService;

  constructor(deps: ContactsServiceDependencies) {
    this.generic = new CrmObjectService({
      objectType: 'contacts',
      client: deps.client,
      logger: deps.logger,
      defaultProperties: DEFAULT_CONTACT_PROPERTIES,
      readOnlyProperties: READ_ONLY_PROPERTIES,
    });
  }

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
   */
  async create(input: CreateContactInput): Promise<CrmObject> {
    const associations = input.associations?.map((association) => ({
      toObjectId: association.toObjectId,
      // `contacts` is the fromType here: contact-to-company is 279, the
      // reverse of company-to-contact (280) — direction matters.
      associationTypeId: getAssociationTypeId('contacts', association.toObjectType),
    }));

    return this.generic.create(input.properties, associations);
  }

  /** Updates properties on an existing contact. PATCH semantics: omitted properties are untouched. */
  async update(input: UpdateContactInput): Promise<CrmObject> {
    return this.generic.update(input.contactId, input.properties);
  }

  /** Reads a contact by record ID. Pass `archived: true` to read a soft-deleted record. */
  async getById(options: {
    readonly contactId: string;
    readonly properties?: readonly string[] | undefined;
    readonly associations?: readonly string[] | undefined;
    readonly archived?: boolean;
  }): Promise<CrmObject & { associations: Record<string, string[]> }> {
    return this.generic.getById({
      id: options.contactId,
      properties: options.properties,
      associations: options.associations,
      ...(options.archived === undefined ? {} : { archived: options.archived }),
    });
  }

  /**
   * Reads a contact by email address, via HubSpot's alternate-key lookup
   * (`idProperty=email`) rather than a search request — a single indexed
   * read instead of a query, so it is both faster and not subject to the
   * search API's separate, tighter rate limit.
   */
  async getByEmail(options: {
    readonly email: string;
    readonly properties?: readonly string[] | undefined;
  }): Promise<CrmObject> {
    try {
      return await this.generic.getByAlternateId({
        value: options.email,
        idProperty: 'email',
        properties: options.properties,
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundError(
          `No HubSpot contact exists with the email address "${options.email}".`
        );
      }
      throw error;
    }
  }

  /** Lists contacts in record order. Use `search` when criteria are needed. */
  async list(input: ListContactsInput): Promise<CrmPage<CrmObject>> {
    return this.generic.list(input);
  }

  /**
   * Searches contacts with filter groups, free-text query, and sorting.
   *
   * @example
   * ```ts
   * await contacts.search({
   *   filterGroups: [{ filters: [
   *     { propertyName: 'lifecyclestage', operator: 'EQ', value: 'lead' },
   *   ]}],
   *   limit: 50,
   * });
   * ```
   */
  async search(input: SearchContactsInput): Promise<CrmPage<CrmObject>> {
    return this.generic.search(input);
  }

  /** Archives (soft-deletes) a contact. Recoverable for 90 days via the HubSpot UI. */
  async archive(contactId: string): Promise<void> {
    return this.generic.archive(contactId);
  }

  /**
   * Permanently and irreversibly deletes a contact (GDPR erasure). The
   * email address is added to a blocklist that prevents it being re-added.
   */
  async deletePermanently(contactId: string): Promise<void> {
    return this.generic.deletePermanently(contactId);
  }

  /** Merges one contact into another. The primary survives and keeps its ID. */
  async merge(primaryContactId: string, contactIdToMerge: string): Promise<CrmObject> {
    return this.generic.merge(primaryContactId, contactIdToMerge);
  }

  /**
   * Recreates a contact from its archived snapshot.
   *
   * HubSpot exposes **no un-archive endpoint** — restoring in place is only
   * possible through the UI recycle bin. The result is a *new* record with a
   * *new* ID; associations, engagements, and timeline history do not come
   * back. Callers must surface that distinction rather than reporting a
   * plain "restored".
   */
  async recreateFromArchive(options: {
    readonly contactId: string;
    readonly properties?: readonly string[] | undefined;
  }): Promise<{
    readonly created: CrmObject;
    readonly sourceProperties: Record<string, string | null>;
  }> {
    return this.generic.recreateFromArchive({
      id: options.contactId,
      properties: options.properties,
    });
  }

  async batchCreate(input: BatchCreateContactsInput): Promise<BatchOutcome<CrmObject>> {
    return this.generic.batchCreate(input.contacts);
  }

  async batchUpdate(input: BatchUpdateContactsInput): Promise<BatchOutcome<CrmObject>> {
    return this.generic.batchUpdate(
      input.contacts.map((c) => ({ id: c.contactId, properties: c.properties }))
    );
  }

  /** Archives up to 100 contacts in one request. */
  async batchArchive(contactIds: readonly string[]): Promise<number> {
    return this.generic.batchArchive(contactIds);
  }

  /** Reads up to 100 contacts by ID or email in one request. */
  async batchRead(input: BatchReadContactsInput): Promise<BatchOutcome<CrmObject>> {
    return this.generic.batchRead({
      ids: input.contactIds,
      idProperty: input.idProperty === 'email' ? 'email' : undefined,
      properties: input.properties,
    });
  }
}
