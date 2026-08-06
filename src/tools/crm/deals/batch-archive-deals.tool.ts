import { z } from 'zod';
import type { DealsService } from '../../../services/deals.service.js';
import {
  batchArchiveDealsInputSchema,
  type BatchArchiveDealsInput,
} from '../../../schemas/deal.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const batchArchiveOutputSchema = z.object({
  success: z.boolean(),
  archivedCount: z.number(),
  dealIds: z.array(z.string()),
  message: z.string(),
});

interface BatchArchiveResult {
  readonly success: boolean;
  readonly archivedCount: number;
  readonly dealIds: readonly string[];
  readonly message: string;
}

/**
 * `hubspot_batch_archive_deals` — archives up to 100 deals per call.
 *
 * Gated the same way as the Contacts/Companies batch archive tools: bulk
 * destruction is high blast-radius, so it requires explicit confirmation
 * even though archiving remains reversible for 90 days.
 *
 * @example
 * ```json
 * { "dealIds": ["9001234567", "9001234568"], "confirmArchive": true }
 * ```
 */
export class BatchArchiveDealsTool implements ToolDefinition<
  typeof batchArchiveDealsInputSchema,
  BatchArchiveResult
> {
  readonly name = 'hubspot_batch_archive_deals';
  readonly title = 'Batch Archive HubSpot Deals';
  readonly description =
    'Archive (soft-delete) up to 100 HubSpot deals in a single request. Archived deals leave ' +
    'the active CRM but stay recoverable from the HubSpot recycle bin for 90 days. Requires ' +
    'confirmArchive to be exactly true. Always confirm the exact list of deal IDs with the user ' +
    'before calling this.';

  readonly inputSchema = batchArchiveDealsInputSchema;
  readonly outputSchema = batchArchiveOutputSchema;

  readonly annotations = {
    title: 'Batch Archive HubSpot Deals',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(
    input: BatchArchiveDealsInput,
    context: ToolExecutionContext
  ): Promise<BatchArchiveResult> {
    context.logger.warn(
      { count: input.dealIds.length, dealIds: input.dealIds },
      'Batch archiving HubSpot deals.'
    );

    const archivedCount = await this.deals.batchArchive(input.dealIds);

    return {
      success: true,
      archivedCount,
      dealIds: input.dealIds,
      message: `${archivedCount} deal(s) archived. They can be restored from the HubSpot recycle bin within 90 days.`,
    };
  }
}
