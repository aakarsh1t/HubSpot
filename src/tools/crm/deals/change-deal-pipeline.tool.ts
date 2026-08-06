import type { DealsService } from '../../../services/deals.service.js';
import {
  changeDealPipelineInputSchema,
  dealOutputSchema,
  type ChangeDealPipelineInput,
} from '../../../schemas/deal.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_change_deal_pipeline` — moves a deal to a different pipeline.
 *
 * Sets `pipeline` and `dealstage` together in a single PATCH, because a
 * stage ID from the old pipeline is meaningless in the new one — HubSpot
 * requires an explicit target stage whenever the pipeline changes, and
 * setting them separately would risk leaving the deal in an inconsistent
 * intermediate state if the second call failed.
 *
 * Call `hubspot_list_deal_pipelines` first to discover valid pipeline and
 * stage IDs.
 *
 * @example
 * ```json
 * { "dealId": "9001234567", "pipelineId": "660001", "stageId": "closedwon" }
 * ```
 */
export class ChangeDealPipelineTool implements ToolDefinition<
  typeof changeDealPipelineInputSchema,
  CrmObject
> {
  readonly name = 'hubspot_change_deal_pipeline';
  readonly title = 'Change HubSpot Deal Pipeline';
  readonly description =
    'Move a deal to a different pipeline, setting both the target pipeline and the stage within ' +
    'it in one operation. A stage from the old pipeline is not valid in the new one, so both ' +
    'pipelineId and stageId are required. Call hubspot_list_deal_pipelines first to discover ' +
    'valid IDs. Use hubspot_move_deal_stage instead if the deal is staying in the same pipeline.';

  readonly inputSchema = changeDealPipelineInputSchema;
  readonly outputSchema = dealOutputSchema;

  readonly annotations = {
    title: 'Change HubSpot Deal Pipeline',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: ChangeDealPipelineInput, context: ToolExecutionContext): Promise<CrmObject> {
    context.logger.info(
      { dealId: input.dealId, pipelineId: input.pipelineId, stageId: input.stageId },
      'Changing HubSpot deal pipeline.'
    );

    return this.deals.changePipeline(input.dealId, input.pipelineId, input.stageId);
  }
}
