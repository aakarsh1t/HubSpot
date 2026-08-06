import type { DealsService } from '../../../services/deals.service.js';
import {
  batchCreateDealsInputSchema,
  dealBatchOutcomeOutputSchema,
  type BatchCreateDealsInput,
} from '../../../schemas/deal.schema.js';
import type { BatchOutcome, CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_batch_create_deals` — creates up to 100 deals per call.
 *
 * @example
 * ```json
 * {
 *   "deals": [
 *     { "properties": { "dealname": "Acme - Q4 renewal", "amount": 20000 } },
 *     { "properties": { "dealname": "Beta - new logo", "amount": 15000 } }
 *   ]
 * }
 * ```
 */
export class BatchCreateDealsTool implements ToolDefinition<
  typeof batchCreateDealsInputSchema,
  BatchOutcome<CrmObject>
> {
  readonly name = 'hubspot_batch_create_deals';
  readonly title = 'Batch Create HubSpot Deals';
  readonly description =
    'Create up to 100 HubSpot deals in a single request. Individual records can fail while ' +
    'others succeed, so always check the returned status (COMPLETE, PARTIAL, or ERROR) together ' +
    'with the succeeded and failed counts and the errors array.';

  readonly inputSchema = batchCreateDealsInputSchema;
  readonly outputSchema = dealBatchOutcomeOutputSchema;

  readonly annotations = {
    title: 'Batch Create HubSpot Deals',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(
    input: BatchCreateDealsInput,
    context: ToolExecutionContext
  ): Promise<BatchOutcome<CrmObject>> {
    context.logger.info({ count: input.deals.length }, 'Batch creating HubSpot deals.');

    const outcome = await this.deals.batchCreate(input);

    if (outcome.failed > 0) {
      context.logger.warn(
        { requested: outcome.requested, succeeded: outcome.succeeded, failed: outcome.failed },
        'Batch deal creation completed with failures.'
      );
    }

    return outcome;
  }
}
