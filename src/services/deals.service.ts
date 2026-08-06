import type { Logger } from 'pino';
import { getAssociationTypeId } from './association-types.js';
import { CrmObjectService } from './crm-object.service.js';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import type {
  BatchOutcome,
  CrmObject,
  CrmPage,
  Pipeline,
  PipelineStage,
} from '../types/crm.types.js';
import type {
  BatchCreateDealsInput,
  BatchReadDealsInput,
  BatchUpdateDealsInput,
  CreateDealInput,
  ListDealsInput,
  SearchDealsInput,
  UpdateDealInput,
} from '../schemas/deal.schema.js';

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
  // Deal-specific: computed/managed by HubSpot as the deal progresses through
  // a pipeline, not settable directly on create.
  'hs_deal_stage_probability',
  'hs_is_closed',
  'hs_is_closed_won',
  'hs_closed_amount',
]);

const DEFAULT_DEAL_PROPERTIES: readonly string[] = [
  'dealname',
  'dealstage',
  'pipeline',
  'amount',
  'closedate',
  'dealtype',
  'hs_forecast_category',
  'hs_forecast_probability',
  'hubspot_owner_id',
  'createdate',
  'hs_lastmodifieddate',
];

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

export interface DealsServiceDependencies {
  readonly client: HubSpotClient;
  readonly logger: Logger;
}

/**
 * Deal-specific HubSpot behaviour, composed over the generic
 * `CrmObjectService` — the same pattern as `ContactsService` and
 * `CompaniesService`.
 *
 * What is genuinely deal-specific, and therefore lives here rather than in
 * the generic base: pipeline and stage management, and forecast category.
 * `dealstage` and `pipeline` are deliberately *not* just properties a caller
 * sets via `update()` — `moveStage` and `changePipeline` exist so an agent
 * moving a deal to a stage in a different pipeline is forced to supply a
 * valid target stage for that pipeline, rather than producing a deal whose
 * stage and pipeline silently disagree.
 */
export class DealsService {
  private readonly generic: CrmObjectService;
  private readonly client: HubSpotClient;
  private readonly logger: Logger;

  constructor(deps: DealsServiceDependencies) {
    this.generic = new CrmObjectService({
      objectType: 'deals',
      client: deps.client,
      logger: deps.logger,
      defaultProperties: DEFAULT_DEAL_PROPERTIES,
      readOnlyProperties: READ_ONLY_PROPERTIES,
    });
    this.client = deps.client;
    this.logger = deps.logger.child({ component: 'deals-service' });
  }

  /**
   * Creates a deal.
   *
   * @example
   * ```ts
   * await deals.create({
   *   properties: { dealname: 'Acme Corp - Enterprise', amount: 50000 },
   *   associations: [{ toObjectType: 'contacts', toObjectId: '512' }],
   * });
   * ```
   */
  async create(input: CreateDealInput): Promise<CrmObject> {
    const associations = input.associations?.map((association) => ({
      toObjectId: association.toObjectId,
      associationTypeId: getAssociationTypeId('deals', association.toObjectType),
    }));

    return this.generic.create(input.properties, associations);
  }

  async update(input: UpdateDealInput): Promise<CrmObject> {
    return this.generic.update(input.dealId, input.properties);
  }

  async getById(options: {
    readonly dealId: string;
    readonly properties?: readonly string[] | undefined;
    readonly associations?: readonly string[] | undefined;
    readonly archived?: boolean;
  }): Promise<CrmObject & { associations: Record<string, string[]> }> {
    return this.generic.getById({
      id: options.dealId,
      properties: options.properties,
      associations: options.associations,
      ...(options.archived === undefined ? {} : { archived: options.archived }),
    });
  }

  async list(input: ListDealsInput): Promise<CrmPage<CrmObject>> {
    return this.generic.list(input);
  }

  async search(input: SearchDealsInput): Promise<CrmPage<CrmObject>> {
    return this.generic.search(input);
  }

  async archive(dealId: string): Promise<void> {
    return this.generic.archive(dealId);
  }

  async deletePermanently(dealId: string): Promise<void> {
    return this.generic.deletePermanently(dealId);
  }

  async merge(primaryDealId: string, dealIdToMerge: string): Promise<CrmObject> {
    return this.generic.merge(primaryDealId, dealIdToMerge);
  }

  async recreateFromArchive(options: {
    readonly dealId: string;
    readonly properties?: readonly string[] | undefined;
  }): Promise<{
    readonly created: CrmObject;
    readonly sourceProperties: Record<string, string | null>;
  }> {
    return this.generic.recreateFromArchive({ id: options.dealId, properties: options.properties });
  }

  async batchCreate(input: BatchCreateDealsInput): Promise<BatchOutcome<CrmObject>> {
    return this.generic.batchCreate(input.deals);
  }

  async batchUpdate(input: BatchUpdateDealsInput): Promise<BatchOutcome<CrmObject>> {
    return this.generic.batchUpdate(
      input.deals.map((d) => ({ id: d.dealId, properties: d.properties }))
    );
  }

  async batchArchive(dealIds: readonly string[]): Promise<number> {
    return this.generic.batchArchive(dealIds);
  }

  async batchRead(input: BatchReadDealsInput): Promise<BatchOutcome<CrmObject>> {
    return this.generic.batchRead({ ids: input.dealIds, properties: input.properties });
  }

  /**
   * Lists every deal pipeline and its ordered stages for this portal.
   *
   * The prerequisite for `moveStage`, `changePipeline`, and any agent
   * decision involving a stage or pipeline: both are opaque HubSpot-assigned
   * IDs with no predictable format, so there is no way to construct a valid
   * one without first listing what actually exists in this portal.
   */
  async listPipelines(): Promise<readonly Pipeline[]> {
    const response = await this.client.request<RawPipelineList>({
      method: 'GET',
      path: '/crm/v3/pipelines/deals',
    });

    return (response.data.results ?? []).map(toPipeline);
  }

  /** Reads a single pipeline (and its stages) by ID. */
  async getPipeline(pipelineId: string): Promise<Pipeline> {
    const response = await this.client.request<RawPipeline>({
      method: 'GET',
      path: `/crm/v3/pipelines/deals/${encodeURIComponent(pipelineId)}`,
    });

    return toPipeline(response.data);
  }

  /**
   * Moves a deal to a different stage **within its current pipeline**.
   *
   * @example
   * ```ts
   * await deals.moveStage('9001', 'appointmentscheduled');
   * ```
   */
  async moveStage(dealId: string, stageId: string): Promise<CrmObject> {
    const updated = await this.generic.update(dealId, { dealstage: stageId });
    this.logger.info({ dealId, stageId }, 'Moved deal to new stage.');
    return updated;
  }

  /**
   * Moves a deal to a stage in a **different** pipeline.
   *
   * Both fields are set in a single PATCH so the deal is never left in the
   * inconsistent intermediate state of belonging to a new pipeline while
   * still carrying a stage ID from the old one.
   */
  async changePipeline(dealId: string, pipelineId: string, stageId: string): Promise<CrmObject> {
    const updated = await this.generic.update(dealId, { pipeline: pipelineId, dealstage: stageId });
    this.logger.info({ dealId, pipelineId, stageId }, 'Changed deal pipeline and stage.');
    return updated;
  }

  /** Sets the deal's forecast category. */
  async setForecastCategory(dealId: string, forecastCategory: string): Promise<CrmObject> {
    const updated = await this.generic.update(dealId, { hs_forecast_category: forecastCategory });
    this.logger.info({ dealId, forecastCategory }, 'Set deal forecast category.');
    return updated;
  }
}

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
  const isClosed = raw.metadata?.isClosed;

  return {
    id: raw.id,
    label: raw.label,
    displayOrder: raw.displayOrder ?? 0,
    probability: probability === undefined ? null : Number(probability),
    isClosed: isClosed === 'true',
  };
}
