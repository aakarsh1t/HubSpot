import type { DealsService } from '../../../services/deals.service.js';
import {
  dealPageOutputSchema,
  searchDealsInputSchema,
  type SearchDealsInput,
} from '../../../schemas/deal.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface SearchResult {
  readonly results: readonly CrmObject[];
  readonly after: string | null;
  readonly total: number | null;
  readonly count: number;
}

/**
 * `hubspot_search_deals` — filtered search over deals.
 *
 * @example Open deals above a value
 * ```json
 * {
 *   "filterGroups": [{ "filters": [
 *     { "propertyName": "amount", "operator": "GTE", "value": 10000 },
 *     { "propertyName": "hs_is_closed", "operator": "EQ", "value": "false" }
 *   ]}]
 * }
 * ```
 *
 * @example Closing this quarter
 * ```json
 * { "filterGroups": [{ "filters": [
 *   { "propertyName": "closedate", "operator": "BETWEEN", "value": "2026-10-01", "highValue": "2026-12-31" }
 * ]}]}
 * ```
 */
export class SearchDealsTool implements ToolDefinition<
  typeof searchDealsInputSchema,
  SearchResult
> {
  readonly name = 'hubspot_search_deals';
  readonly title = 'Search HubSpot Deals';
  readonly description =
    'Search HubSpot deals by property values or free text. Use filterGroups for structured ' +
    'criteria: filters inside one group are combined with AND, and separate groups are combined ' +
    'with OR. Operators: EQ, NEQ, LT, LTE, GT, GTE, BETWEEN (needs value and highValue — useful ' +
    'for amount or closedate ranges), IN and NOT_IN (need a values array), HAS_PROPERTY, ' +
    'NOT_HAS_PROPERTY, CONTAINS_TOKEN and NOT_CONTAINS_TOKEN. HubSpot limits: 5 filter groups, ' +
    '6 filters each, 18 total, 200 results per page.';

  readonly inputSchema = searchDealsInputSchema;
  readonly outputSchema = dealPageOutputSchema;

  readonly annotations = {
    title: 'Search HubSpot Deals',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly deals: DealsService;

  constructor(deals: DealsService) {
    this.deals = deals;
  }

  async execute(input: SearchDealsInput, context: ToolExecutionContext): Promise<SearchResult> {
    context.logger.debug(
      { hasQuery: input.query !== undefined, filterGroups: input.filterGroups?.length ?? 0 },
      'Searching HubSpot deals.'
    );

    const page = await this.deals.search(input);
    return { ...page, count: page.results.length };
  }
}
