import type { DealsService } from '../../../services/deals.service.js';
import {
  dealPageOutputSchema,
  listDealsInputSchema,
  type ListDealsInput,
} from '../../../schemas/deal.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface DealPageResult {
  readonly results: readonly CrmObject[];
  readonly after: string | null;
  readonly total: number | null;
  readonly count: number;
}

/**
 * `hubspot_list_deals` — pages through deals without search criteria.
 *
 * @example
 * ```json
 * { "limit": 25 }
 * ```
 */
export class ListDealsTool implements ToolDefinition<typeof listDealsInputSchema, DealPageResult> {
  readonly name = 'hubspot_list_deals';
  readonly title = 'List HubSpot Deals';
  readonly description =
    'List HubSpot deals page by page, without any search criteria. Returns up to 100 per call ' +
    'along with an "after" cursor; pass that cursor back to fetch the next page, and stop when ' +
    'it is null. Use hubspot_search_deals instead when you need to filter by property values ' +
    '(e.g. stage, amount, close date). Set archived to true to list deleted deals.';

  readonly inputSchema = listDealsInputSchema;
  readonly outputSchema = dealPageOutputSchema;

  readonly annotations = {
    title: 'List HubSpot Deals',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: ListDealsInput, context: ToolExecutionContext): Promise<DealPageResult> {
    context.logger.debug(
      { limit: input.limit, archived: input.archived },
      'Listing HubSpot deals.'
    );

    const page = await this.deals.list(input);
    return { ...page, count: page.results.length };
  }
}
