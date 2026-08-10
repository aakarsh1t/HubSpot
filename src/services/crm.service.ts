import type { Logger } from 'pino';
import { DEFAULT_OBJECT_PROPERTIES, getAssociationTypeId } from './association-types.js';
import { CrmObjectService } from './crm-object.service.js';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import type { CrmObject, CrmObjectType, Pipeline, PipelineStage } from '../types/crm.types.js';

/**
 * HubSpot-managed properties that cannot be written on create. Attempting to
 * set one produces a 400 that is easy to misdiagnose as a permissions problem,
 * and `recreateFromArchive` would otherwise hit it on every restore by echoing
 * the archived snapshot straight back.
 */
const COMMON_READ_ONLY_PROPERTIES = [
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
] as const;

const READ_ONLY_PROPERTIES: Readonly<Record<CrmObjectType, ReadonlySet<string>>> = Object.freeze({
  contacts: new Set<string>(COMMON_READ_ONLY_PROPERTIES),
  companies: new Set<string>(COMMON_READ_ONLY_PROPERTIES),
  // Deal-specific: computed by HubSpot as the deal moves through a pipeline.
  deals: new Set<string>([
    ...COMMON_READ_ONLY_PROPERTIES,
    'hs_deal_stage_probability',
    'hs_is_closed',
    'hs_is_closed_won',
    'hs_closed_amount',
  ]),
});

/** Object types HubSpot exposes pipelines for. */
export type PipelineObjectType = 'deals' | 'tickets';

interface RawPipelineStage {
  readonly id: string;
  readonly label: string;
  readonly displayOrder?: number;
  readonly metadata?: { readonly probability?: string; readonly isClosed?: string };
}

interface RawPipeline {
  readonly id: string;
  readonly label: string;
  readonly displayOrder?: number;
  readonly stages?: RawPipelineStage[];
}

interface RawPipelineList {
  readonly results?: RawPipeline[];
}

export interface CrmServiceDependencies {
  readonly client: HubSpotClient;
  readonly logger: Logger;
}

/**
 * The entry point for every CRM record operation, across every object type.
 *
 * HubSpot's v3 Objects API is one generic surface parameterized by object type,
 * and `CrmObjectService` already implements it once. What this class adds is
 * the *routing*: it holds one configured `CrmObjectService` per object type and
 * hands the right one to a caller that only knows `objectType` at runtime —
 * which is precisely the shape the consolidated tools need, since object type
 * arrives as a tool argument rather than being baked into the tool.
 *
 * It replaces the previous `ContactsService` / `CompaniesService` /
 * `DealsService` trio. Those were pass-through wrappers whose only real
 * contribution was renaming `id` to `contactId` / `companyId` / `dealId`, which
 * bought nothing once the object type became a parameter — and cost three
 * copies of every method signature.
 *
 * Adding a fourth object type (Tickets) is one union member in
 * `CrmObjectType` plus one entry in the tables above. No tool changes.
 */
export class CrmService {
  private readonly objects: Readonly<Record<CrmObjectType, CrmObjectService>>;
  private readonly client: HubSpotClient;
  private readonly logger: Logger;

  constructor(deps: CrmServiceDependencies) {
    const build = (objectType: CrmObjectType): CrmObjectService =>
      new CrmObjectService({
        objectType,
        client: deps.client,
        logger: deps.logger,
        defaultProperties: DEFAULT_OBJECT_PROPERTIES[objectType],
        readOnlyProperties: READ_ONLY_PROPERTIES[objectType],
      });

    this.objects = Object.freeze({
      contacts: build('contacts'),
      companies: build('companies'),
      deals: build('deals'),
    });

    this.client = deps.client;
    this.logger = deps.logger.child({ component: 'crm-service' });
  }

  /** The generic record operations for one object type. */
  forType(objectType: CrmObjectType): CrmObjectService {
    return this.objects[objectType];
  }

  /**
   * Resolves the HubSpot-defined association type ID for a create-time
   * association, in the correct direction.
   *
   * Direction is not symmetric in HubSpot — contact→company (279) and
   * company→contact (280) are different IDs — so this is centralized rather
   * than re-derived per caller.
   */
  associationTypeIdFor(fromObjectType: CrmObjectType, toObjectType: string): number {
    return getAssociationTypeId(fromObjectType, toObjectType);
  }

  /**
   * Lists every pipeline and its ordered stages for an object type.
   *
   * The prerequisite for any stage or pipeline change: both are opaque
   * HubSpot-assigned IDs with no predictable format, so a valid one cannot be
   * constructed without first reading what exists in this portal.
   */
  async listPipelines(objectType: PipelineObjectType): Promise<readonly Pipeline[]> {
    const response = await this.client.request<RawPipelineList>({
      method: 'GET',
      path: `/crm/v3/pipelines/${objectType}`,
    });

    const pipelines = (response.data.results ?? []).map(toPipeline);
    this.logger.debug({ objectType, count: pipelines.length }, 'Listed pipelines.');
    return pipelines;
  }

  /** Builds the create-time association payload `CrmObjectService.create` expects. */
  toCreateAssociations(
    fromObjectType: CrmObjectType,
    associations: readonly { readonly toObjectType: string; readonly toObjectId: string }[]
  ): { readonly toObjectId: string; readonly associationTypeId: number }[] {
    return associations.map((association) => ({
      toObjectId: association.toObjectId,
      associationTypeId: this.associationTypeIdFor(fromObjectType, association.toObjectType),
    }));
  }
}

/** Re-exported so tools can name the shape without importing the service. */
export type { CrmObject };

function toPipeline(raw: RawPipeline): Pipeline {
  return {
    id: raw.id,
    label: raw.label,
    displayOrder: raw.displayOrder ?? 0,
    stages: (raw.stages ?? []).map(toPipelineStage),
  };
}

function toPipelineStage(raw: RawPipelineStage): PipelineStage {
  const probability = raw.metadata?.probability;

  return {
    id: raw.id,
    label: raw.label,
    displayOrder: raw.displayOrder ?? 0,
    probability: probability === undefined ? null : Number(probability),
    isClosed: raw.metadata?.isClosed === 'true',
  };
}
