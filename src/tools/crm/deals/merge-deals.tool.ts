import { z } from 'zod';
import type { DealsService } from '../../../services/deals.service.js';
import { mergeDealsInputSchema, type MergeDealsInput } from '../../../schemas/deal.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const mergeOutputSchema = z.object({
  success: z.boolean(),
  primaryDealId: z.string(),
  mergedDealId: z.string(),
  message: z.string(),
});

interface MergeResult {
  readonly success: boolean;
  readonly primaryDealId: string;
  readonly mergedDealId: string;
  readonly message: string;
}

/**
 * `hubspot_merge_deals` — merges one deal into another.
 *
 * Irreversible through the API. Carries the same literal-true confirmation
 * gate and self-merge guard as the Contacts and Companies equivalents.
 *
 * @example
 * ```json
 * { "primaryDealId": "9001234567", "dealIdToMerge": "9001234568", "confirmMerge": true }
 * ```
 */
export class MergeDealsTool implements ToolDefinition<typeof mergeDealsInputSchema, MergeResult> {
  readonly name = 'hubspot_merge_deals';
  readonly title = 'Merge HubSpot Deals';
  readonly description =
    'Merge two duplicate HubSpot deals into one. The primary deal survives and keeps its ' +
    'record ID; the other deal is absorbed into it. Where both deals have a value for the same ' +
    'property, the primary wins. This cannot be undone through the API, so confirmMerge must be ' +
    'exactly true.';

  readonly inputSchema = mergeDealsInputSchema;
  readonly outputSchema = mergeOutputSchema;

  readonly annotations = {
    title: 'Merge HubSpot Deals',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: MergeDealsInput, context: ToolExecutionContext): Promise<MergeResult> {
    context.logger.warn(
      {
        primaryDealId: input.primaryDealId,
        dealIdToMerge: input.dealIdToMerge,
        irreversible: true,
      },
      'Merging HubSpot deals.'
    );

    const merged = await this.deals.merge(input.primaryDealId, input.dealIdToMerge);

    return {
      success: true,
      primaryDealId: merged.id,
      mergedDealId: input.dealIdToMerge,
      message: `Deal ${input.dealIdToMerge} was merged into ${merged.id}, which survives with its original ID. This cannot be undone.`,
    };
  }
}
