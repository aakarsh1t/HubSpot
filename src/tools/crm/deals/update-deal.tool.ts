import type { DealsService } from '../../../services/deals.service.js';
import {
  dealOutputSchema,
  updateDealInputSchema,
  type UpdateDealInput,
} from '../../../schemas/deal.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_update_deal` — updates properties on an existing deal.
 *
 * PATCH semantics: only the supplied properties change. For stage or
 * pipeline changes, prefer `hubspot_move_deal_stage` or
 * `hubspot_change_deal_pipeline` — they validate the stage belongs to the
 * pipeline, which a raw property update on this tool does not.
 *
 * @example
 * ```json
 * { "dealId": "9001234567", "properties": { "amount": 75000 } }
 * ```
 */
export class UpdateDealTool implements ToolDefinition<typeof updateDealInputSchema, CrmObject> {
  readonly name = 'hubspot_update_deal';
  readonly title = 'Update HubSpot Deal';
  readonly description =
    'Update one or more properties on an existing HubSpot deal, identified by its record ID. ' +
    'Only the properties you supply are changed. For moving a deal to a different stage or ' +
    'pipeline, use hubspot_move_deal_stage or hubspot_change_deal_pipeline instead — they ' +
    'validate the target stage belongs to the right pipeline, which a raw property update here ' +
    'does not. Returns the updated deal.';

  readonly inputSchema = updateDealInputSchema;
  readonly outputSchema = dealOutputSchema;

  readonly annotations = {
    title: 'Update HubSpot Deal',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: UpdateDealInput, context: ToolExecutionContext): Promise<CrmObject> {
    context.logger.debug(
      { dealId: input.dealId, properties: Object.keys(input.properties) },
      'Updating HubSpot deal.'
    );

    return this.deals.update(input);
  }
}
