import type { DealsService } from '../../../services/deals.service.js';
import {
  listPipelinesInputSchema,
  listPipelinesOutputSchema,
  type ListPipelinesInput,
} from '../../../schemas/deal.schema.js';
import type { Pipeline } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface ListPipelinesResult {
  readonly pipelines: readonly Pipeline[];
  readonly count: number;
}

/**
 * `hubspot_list_deal_pipelines` — every deal pipeline and its stages.
 *
 * The prerequisite for `hubspot_move_deal_stage`, `hubspot_change_deal_pipeline`,
 * and any decision involving a stage: both pipeline and stage IDs are opaque
 * HubSpot-generated identifiers with no predictable format (not the visible
 * label shown in the UI), so there is no way to construct a valid one
 * without listing what actually exists in this portal first. Call this tool
 * before either of those, and match on `label` (what a human would recognise,
 * e.g. "Appointment Scheduled") to find the `id` to actually pass.
 *
 * @example
 * ```json
 * {}
 * ```
 */
export class ListDealPipelinesTool implements ToolDefinition<
  typeof listPipelinesInputSchema,
  ListPipelinesResult
> {
  readonly name = 'hubspot_list_deal_pipelines';
  readonly title = 'List HubSpot Deal Pipelines';
  readonly description =
    'List every deal pipeline configured in this HubSpot portal, with its ordered stages. Each ' +
    'stage includes its id (an opaque identifier — pass this to hubspot_move_deal_stage or ' +
    'hubspot_change_deal_pipeline), its human-readable label, its position, and metadata ' +
    '(probability and whether it counts as closed). Call this tool BEFORE moving a deal to a ' +
    'stage or pipeline whose exact ID you do not already know.';

  readonly inputSchema = listPipelinesInputSchema;
  readonly outputSchema = listPipelinesOutputSchema;

  readonly annotations = {
    title: 'List HubSpot Deal Pipelines',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(
    _input: ListPipelinesInput,
    context: ToolExecutionContext
  ): Promise<ListPipelinesResult> {
    context.logger.debug('Listing HubSpot deal pipelines.');

    const pipelines = await this.deals.listPipelines();
    return { pipelines, count: pipelines.length };
  }
}
