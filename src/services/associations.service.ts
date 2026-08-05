import type { Logger } from 'pino';
import { CONTACT_TO_OBJECT_TYPE_ID, HUBSPOT_DEFINED } from './association-types.js';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import type { AssociableObjectType, AssociationRef, CrmPage } from '../types/crm.types.js';

const ASSOCIATIONS_V4_BASE = '/crm/v4/objects/contacts';

interface RawAssociationResult {
  readonly toObjectId?: number | string;
  readonly associationTypes?: {
    readonly category?: string;
    readonly typeId?: number;
    readonly label?: string | null;
  }[];
}

interface RawAssociationPage {
  readonly results?: RawAssociationResult[];
  readonly paging?: { readonly next?: { readonly after?: string } };
}

export interface AssociationsServiceDependencies {
  readonly client: HubSpotClient;
  readonly logger: Logger;
}

/**
 * Contact association management, built on HubSpot's associations **v4** API.
 *
 * v4 is used rather than the v3 associations endpoints because v3 is
 * deprecated and cannot express association *labels* — the mechanism portals
 * use to distinguish, say, a "decision maker" from a "billing contact" on the
 * same company.
 *
 * Association direction is asymmetric in HubSpot: contact→company and
 * company→contact are different type IDs. Everything here operates in the
 * contact→object direction, and the verified IDs live in
 * `association-types.ts` rather than being inlined at call sites.
 */
export class AssociationsService {
  private readonly client: HubSpotClient;
  private readonly logger: Logger;

  constructor(deps: AssociationsServiceDependencies) {
    this.client = deps.client;
    this.logger = deps.logger.child({ component: 'associations-service' });
  }

  /**
   * Lists records of one type associated with a contact.
   *
   * @example
   * ```ts
   * const companies = await associations.list({
   *   contactId: '512',
   *   toObjectType: 'companies',
   *   limit: 100,
   * });
   * ```
   */
  async list(options: {
    readonly contactId: string;
    readonly toObjectType: AssociableObjectType;
    readonly limit: number;
    readonly after?: string | undefined;
  }): Promise<CrmPage<AssociationRef>> {
    const query: Record<string, string | number> = { limit: options.limit };
    if (options.after !== undefined) {
      query.after = options.after;
    }

    const response = await this.client.request<RawAssociationPage>({
      method: 'GET',
      path: `${ASSOCIATIONS_V4_BASE}/${encodeURIComponent(options.contactId)}/associations/${options.toObjectType}`,
      query,
    });

    const results: AssociationRef[] = (response.data.results ?? []).map((result) => ({
      toObjectId: String(result.toObjectId ?? ''),
      toObjectType: options.toObjectType,
      associationTypes: (result.associationTypes ?? []).map((type) => ({
        category: type.category ?? HUBSPOT_DEFINED,
        typeId: type.typeId ?? 0,
        label: type.label ?? null,
      })),
    }));

    return {
      results,
      after: response.data.paging?.next?.after ?? null,
      total: null,
    };
  }

  /**
   * Associates a contact with another record.
   *
   * Uses `PUT .../associations/{type}/{id}` with an explicit association type.
   * PUT is idempotent — associating twice is a no-op rather than an error — so
   * this call is safe to retry.
   *
   * @param associationTypeId optional custom (labelled) association type.
   *   Omit to use the HubSpot-defined default for the object pair.
   */
  async create(options: {
    readonly contactId: string;
    readonly toObjectType: AssociableObjectType;
    readonly toObjectId: string;
    readonly associationTypeId?: number | undefined;
  }): Promise<void> {
    const typeId = options.associationTypeId ?? CONTACT_TO_OBJECT_TYPE_ID[options.toObjectType];

    await this.client.request<unknown>({
      method: 'PUT',
      path: `${ASSOCIATIONS_V4_BASE}/${encodeURIComponent(options.contactId)}/associations/${options.toObjectType}/${encodeURIComponent(options.toObjectId)}`,
      body: [
        {
          associationCategory:
            options.associationTypeId === undefined ? HUBSPOT_DEFINED : 'USER_DEFINED',
          associationTypeId: typeId,
        },
      ],
      retryable: true,
    });

    this.logger.info(
      {
        contactId: options.contactId,
        toObjectType: options.toObjectType,
        toObjectId: options.toObjectId,
        associationTypeId: typeId,
      },
      'Created contact association.'
    );
  }

  /**
   * Removes every association between a contact and another record.
   *
   * HubSpot's v4 DELETE removes all association types between the pair, not
   * just the default one. The records themselves are untouched.
   */
  async remove(options: {
    readonly contactId: string;
    readonly toObjectType: AssociableObjectType;
    readonly toObjectId: string;
  }): Promise<void> {
    await this.client.request<null>({
      method: 'DELETE',
      path: `${ASSOCIATIONS_V4_BASE}/${encodeURIComponent(options.contactId)}/associations/${options.toObjectType}/${encodeURIComponent(options.toObjectId)}`,
      retryable: false,
    });

    this.logger.warn(
      {
        contactId: options.contactId,
        toObjectType: options.toObjectType,
        toObjectId: options.toObjectId,
      },
      'Removed contact association.'
    );
  }
}
