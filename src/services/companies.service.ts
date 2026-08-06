import type { Logger } from 'pino';
import { getAssociationTypeId } from './association-types.js';
import { CrmObjectService } from './crm-object.service.js';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import type { BatchOutcome, CrmObject, CrmPage } from '../types/crm.types.js';
import type {
  BatchCreateCompaniesInput,
  BatchReadCompaniesInput,
  BatchUpdateCompaniesInput,
  CreateCompanyInput,
  ListCompaniesInput,
  SearchCompaniesInput,
  UpdateCompanyInput,
} from '../schemas/company.schema.js';

const READ_ONLY_PROPERTIES = new Set([
  'hs_object_id',
  'createdate',
  'hs_lastmodifieddate',
  'hs_createdate',
  'hs_all_owner_ids',
  'hs_all_team_ids',
  'hs_object_source',
  'hs_object_source_id',
  'hs_object_source_label',
]);

const DEFAULT_COMPANY_PROPERTIES: readonly string[] = [
  'name',
  'domain',
  'website',
  'phone',
  'industry',
  'city',
  'state',
  'country',
  'numberofemployees',
  'annualrevenue',
  'lifecyclestage',
  'hubspot_owner_id',
  'createdate',
  'hs_lastmodifieddate',
];

export interface CompaniesServiceDependencies {
  readonly client: HubSpotClient;
  readonly logger: Logger;
}

/**
 * Company-specific HubSpot behaviour, composed over the generic
 * `CrmObjectService` — the same pattern as `ContactsService`.
 *
 * Notably thinner than `ContactsService`: companies have no reliable
 * alternate-key lookup (see `company.schema.ts` for why domain-based lookup
 * is intentionally not offered here), so this class adds only the
 * association-shorthand used on create. Everything else — CRUD, search,
 * batch, merge, archived-record recovery — is the unmodified generic
 * implementation.
 */
export class CompaniesService {
  private readonly generic: CrmObjectService;

  constructor(deps: CompaniesServiceDependencies) {
    this.generic = new CrmObjectService({
      objectType: 'companies',
      client: deps.client,
      logger: deps.logger,
      defaultProperties: DEFAULT_COMPANY_PROPERTIES,
      readOnlyProperties: READ_ONLY_PROPERTIES,
    });
  }

  /**
   * Creates a company.
   *
   * @example
   * ```ts
   * await companies.create({
   *   properties: { name: 'Acme Corp', domain: 'acme.com' },
   *   associations: [{ toObjectType: 'contacts', toObjectId: '512' }],
   * });
   * ```
   */
  async create(input: CreateCompanyInput): Promise<CrmObject> {
    const associations = input.associations?.map((association) => ({
      toObjectId: association.toObjectId,
      associationTypeId: getAssociationTypeId('companies', association.toObjectType),
    }));

    return this.generic.create(input.properties, associations);
  }

  async update(input: UpdateCompanyInput): Promise<CrmObject> {
    return this.generic.update(input.companyId, input.properties);
  }

  async getById(options: {
    readonly companyId: string;
    readonly properties?: readonly string[] | undefined;
    readonly associations?: readonly string[] | undefined;
    readonly archived?: boolean;
  }): Promise<CrmObject & { associations: Record<string, string[]> }> {
    return this.generic.getById({
      id: options.companyId,
      properties: options.properties,
      associations: options.associations,
      ...(options.archived === undefined ? {} : { archived: options.archived }),
    });
  }

  async list(input: ListCompaniesInput): Promise<CrmPage<CrmObject>> {
    return this.generic.list(input);
  }

  /**
   * Searches companies with filter groups, free-text query, and sorting.
   * The reliable way to look a company up by domain: filter on
   * `{ propertyName: 'domain', operator: 'EQ', value: '...' }`.
   */
  async search(input: SearchCompaniesInput): Promise<CrmPage<CrmObject>> {
    return this.generic.search(input);
  }

  async archive(companyId: string): Promise<void> {
    return this.generic.archive(companyId);
  }

  async deletePermanently(companyId: string): Promise<void> {
    return this.generic.deletePermanently(companyId);
  }

  async merge(primaryCompanyId: string, companyIdToMerge: string): Promise<CrmObject> {
    return this.generic.merge(primaryCompanyId, companyIdToMerge);
  }

  async recreateFromArchive(options: {
    readonly companyId: string;
    readonly properties?: readonly string[] | undefined;
  }): Promise<{
    readonly created: CrmObject;
    readonly sourceProperties: Record<string, string | null>;
  }> {
    return this.generic.recreateFromArchive({
      id: options.companyId,
      properties: options.properties,
    });
  }

  async batchCreate(input: BatchCreateCompaniesInput): Promise<BatchOutcome<CrmObject>> {
    return this.generic.batchCreate(input.companies);
  }

  async batchUpdate(input: BatchUpdateCompaniesInput): Promise<BatchOutcome<CrmObject>> {
    return this.generic.batchUpdate(
      input.companies.map((c) => ({ id: c.companyId, properties: c.properties }))
    );
  }

  async batchArchive(companyIds: readonly string[]): Promise<number> {
    return this.generic.batchArchive(companyIds);
  }

  async batchRead(input: BatchReadCompaniesInput): Promise<BatchOutcome<CrmObject>> {
    return this.generic.batchRead({ ids: input.companyIds, properties: input.properties });
  }
}
