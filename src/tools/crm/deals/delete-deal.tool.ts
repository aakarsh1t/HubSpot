import type { DealsService } from '../../../services/deals.service.js';
import {
  dealOperationResultSchema,
  deleteDealInputSchema,
  type DeleteDealInput,
} from '../../../schemas/deal.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface DeleteResult {
  readonly success: boolean;
  readonly dealId: string | null;
  readonly message: string;
}

/**
 * `hubspot_delete_deal_permanently` — irreversible GDPR erasure.
 *
 * Gated the same way as its Contacts and Companies counterparts.
 *
 * @example
 * ```json
 * { "dealId": "9001234567", "confirmPermanentDeletion": true }
 * ```
 */
export class DeleteDealTool implements ToolDefinition<typeof deleteDealInputSchema, DeleteResult> {
  readonly name = 'hubspot_delete_deal_permanently';
  readonly title = 'Permanently Delete HubSpot Deal (GDPR)';
  readonly description =
    'PERMANENTLY and irreversibly delete a HubSpot deal using GDPR erasure. The deal and its ' +
    'history cannot be recovered by anyone, including HubSpot support. Requires ' +
    'confirmPermanentDeletion to be exactly true. Do NOT use this for ordinary deletion requests ' +
    '— use hubspot_archive_deal, which is reversible for 90 days.';

  readonly inputSchema = deleteDealInputSchema;
  readonly outputSchema = dealOperationResultSchema;

  readonly annotations = {
    title: 'Permanently Delete HubSpot Deal (GDPR)',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: DeleteDealInput, context: ToolExecutionContext): Promise<DeleteResult> {
    context.logger.warn(
      { dealId: input.dealId, operation: 'gdpr_permanent_delete', irreversible: true },
      'Permanently deleting HubSpot deal (GDPR erasure).'
    );

    await this.deals.deletePermanently(input.dealId);

    return {
      success: true,
      dealId: input.dealId,
      message: `Deal ${input.dealId} has been PERMANENTLY deleted under GDPR erasure. This cannot be undone.`,
    };
  }
}
