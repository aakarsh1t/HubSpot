import type { DealsService } from '../../../services/deals.service.js';
import {
  batchReadDealsInputSchema,
  dealBatchOutcomeOutputSchema,
  type BatchReadDealsInput,
} from '../../../schemas/deal.schema.js';
import type { BatchOutcome, CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_batch_read_deals` — reads up to 100 deals in one call.
 *
 * @example
 * ```json
 * { "dealIds": ["9001234567", "9001234568"] }
 * ```
 */
export class BatchReadDealsTool implements ToolDefinition<
  typeof batchReadDealsInputSchema,
  BatchOutcome<CrmObject>
> {
  readonly name = 'hubspot_batch_read_deals';
  readonly title = 'Batch Read HubSpot Deals';
  readonly description =
    'Retrieve up to 100 HubSpot deals in a single request, by record ID. Always prefer this over ' +
    'calling hubspot_get_deal repeatedly when you need several deals. IDs that do not exist are ' +
    'reported in the errors array rather than failing the whole request.';

  readonly inputSchema = batchReadDealsInputSchema;
  readonly outputSchema = dealBatchOutcomeOutputSchema;

  readonly annotations = {
    title: 'Batch Read HubSpot Deals',
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
    input: BatchReadDealsInput,
    context: ToolExecutionContext
  ): Promise<BatchOutcome<CrmObject>> {
    context.logger.debug({ count: input.dealIds.length }, 'Batch reading HubSpot deals.');
    return this.deals.batchRead(input);
  }
}
