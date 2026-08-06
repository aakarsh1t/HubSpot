import type { DealsService } from '../../../services/deals.service.js';
import {
  dealOutputSchema,
  moveDealStageInputSchema,
  type MoveDealStageInput,
} from '../../../schemas/deal.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_move_deal_stage` — moves a deal to a stage within its current pipeline.
 *
 * A dedicated tool rather than a generic property update because `dealstage`
 * IDs are pipeline-scoped: a stage ID only means something within the
 * pipeline it belongs to. This tool moves within the deal's *current*
 * pipeline; to move a deal into a different pipeline (and therefore a stage
 * from that different pipeline), use `hubspot_change_deal_pipeline` instead,
 * which sets both together so the deal can never end up with a stage that
 * does not belong to its pipeline.
 *
 * Call `hubspot_list_deal_pipelines` first to discover valid stage IDs.
 *
 * @example
 * ```json
 * { "dealId": "9001234567", "stageId": "appointmentscheduled" }
 * ```
 */
export class MoveDealStageTool implements ToolDefinition<
  typeof moveDealStageInputSchema,
  CrmObject
> {
  readonly name = 'hubspot_move_deal_stage';
  readonly title = 'Move HubSpot Deal to a New Stage';
  readonly description =
    'Move a deal to a different stage within its CURRENT pipeline. stageId must be a valid ' +
    'stage in the pipeline the deal is already in — call hubspot_list_deal_pipelines first if ' +
    'you do not already know the exact stage ID. To move a deal to a stage in a DIFFERENT ' +
    'pipeline, use hubspot_change_deal_pipeline instead.';

  readonly inputSchema = moveDealStageInputSchema;
  readonly outputSchema = dealOutputSchema;

  readonly annotations = {
    title: 'Move HubSpot Deal to a New Stage',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: MoveDealStageInput, context: ToolExecutionContext): Promise<CrmObject> {
    context.logger.info(
      { dealId: input.dealId, stageId: input.stageId },
      'Moving HubSpot deal stage.'
    );

    return this.deals.moveStage(input.dealId, input.stageId);
  }
}
