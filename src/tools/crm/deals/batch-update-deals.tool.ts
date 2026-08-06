import type { DealsService } from '../../../services/deals.service.js';
import {
  batchUpdateDealsInputSchema,
  dealBatchOutcomeOutputSchema,
  type BatchUpdateDealsInput,
} from '../../../schemas/deal.schema.js';
import type { BatchOutcome, CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_batch_update_deals` — updates up to 100 deals per call.
 *
 * Idempotent — each entry is addressed by record ID with PATCH semantics.
 *
 * @example
 * ```json
 * { "deals": [{ "dealId": "9001234567", "properties": { "amount": 55000 } }] }
 * ```
 */
export class BatchUpdateDealsTool implements ToolDefinition<
  typeof batchUpdateDealsInputSchema,
  BatchOutcome<CrmObject>
> {
  readonly name = 'hubspot_batch_update_deals';
  readonly title = 'Batch Update HubSpot Deals';
  readonly description =
    'Update up to 100 existing HubSpot deals in a single request. Each entry needs a deal ID ' +
    'and the properties to change; unlisted properties are left untouched. Check the returned ' +
    'status, succeeded/failed counts, and errors array.';

  readonly inputSchema = batchUpdateDealsInputSchema;
  readonly outputSchema = dealBatchOutcomeOutputSchema;

  readonly annotations = {
    title: 'Batch Update HubSpot Deals',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(
    input: BatchUpdateDealsInput,
    context: ToolExecutionContext
  ): Promise<BatchOutcome<CrmObject>> {
    context.logger.info({ count: input.deals.length }, 'Batch updating HubSpot deals.');

    const outcome = await this.deals.batchUpdate(input);

    if (outcome.failed > 0) {
      context.logger.warn(
        { requested: outcome.requested, succeeded: outcome.succeeded, failed: outcome.failed },
        'Batch deal update completed with failures.'
      );
    }

    return outcome;
  }
}
