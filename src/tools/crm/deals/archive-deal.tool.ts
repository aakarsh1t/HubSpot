import type { DealsService } from '../../../services/deals.service.js';
import {
  archiveDealInputSchema,
  dealOperationResultSchema,
  type ArchiveDealInput,
} from '../../../schemas/deal.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface ArchiveResult {
  readonly success: boolean;
  readonly dealId: string | null;
  readonly message: string;
}

/**
 * `hubspot_archive_deal` — soft-deletes a deal.
 *
 * Recoverable from the UI recycle bin for 90 days.
 *
 * @example
 * ```json
 * { "dealId": "9001234567" }
 * ```
 */
export class ArchiveDealTool implements ToolDefinition<
  typeof archiveDealInputSchema,
  ArchiveResult
> {
  readonly name = 'hubspot_archive_deal';
  readonly title = 'Archive HubSpot Deal';
  readonly description =
    'Archive (soft-delete) a HubSpot deal. The deal is removed from the active CRM but remains ' +
    'recoverable from the HubSpot recycle bin for 90 days. This is the correct tool for a normal ' +
    '"delete this deal" request. Only use hubspot_delete_deal_permanently when irreversible ' +
    'GDPR erasure is explicitly required.';

  readonly inputSchema = archiveDealInputSchema;
  readonly outputSchema = dealOperationResultSchema;

  readonly annotations = {
    title: 'Archive HubSpot Deal',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: ArchiveDealInput, context: ToolExecutionContext): Promise<ArchiveResult> {
    context.logger.warn({ dealId: input.dealId }, 'Archiving HubSpot deal.');

    await this.deals.archive(input.dealId);

    return {
      success: true,
      dealId: input.dealId,
      message: `Deal ${input.dealId} has been archived. It can be restored from the HubSpot recycle bin within 90 days.`,
    };
  }
}
