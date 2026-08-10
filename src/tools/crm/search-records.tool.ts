import { toRecordPageView, type RecordPageView } from './record-view.js';
import type { CrmService } from '../../services/crm.service.js';
import {
  recordPageOutputSchema,
  searchRecordsInputSchema,
  type SearchRecordsInput,
} from '../../schemas/crm.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

/**
 * `hubspot_search_records` — finds contacts, companies, or deals.
 *
 * Replaces six tools: `list_*` and `search_*` for all three object types.
 * Collapsing list into search is safe because the distinction that mattered is
 * an implementation detail, and it is handled here rather than by the agent:
 * with no criteria this routes to HubSpot's list endpoint — cheaper, and in a
 * separate, more generous rate-limit bucket than search — and with criteria it
 * routes to the search endpoint. An agent that previously had to know which of
 * two tools to reach for now cannot get it wrong.
 *
 * @example Free-text
 * ```json
 * { "objectType": "companies", "query": "acme" }
 * ```
 *
 * @example Filtered, newest first
 * ```json
 * {
 *   "objectType": "deals",
 *   "filterGroups": [{ "filters": [
 *     { "propertyName": "dealstage", "operator": "EQ", "value": "contractsent" }
 *   ]}],
 *   "sorts": [{ "propertyName": "createdate", "direction": "DESCENDING" }],
 *   "limit": 50
 * }
 * ```
 *
 * @example Plain listing (routes to the list endpoint)
 * ```json
 * { "objectType": "contacts", "limit": 25 }
 * ```
 */
export class SearchRecordsTool implements ToolDefinition<
  typeof searchRecordsInputSchema,
  RecordPageView
> {
  readonly name = 'hubspot_search_records';
  readonly title = 'Search HubSpot Records';
  readonly description =
    'Find HubSpot contacts, companies, or deals. Supply query for free-text search, filterGroups ' +
    'for precise criteria (filters within a group are ANDed, groups are ORed), or neither to list ' +
    'records in record order. Supports sorting, pagination via after, and archived listings. ' +
    'Use hubspot_get_record instead when you already know the ID or email.';

  readonly inputSchema = searchRecordsInputSchema;
  readonly outputSchema = recordPageOutputSchema;

  readonly annotations = {
    title: 'Search HubSpot Records',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly crm: CrmService;

  constructor(crm: CrmService) {
    this.crm = crm;
  }

  async execute(input: SearchRecordsInput, context: ToolExecutionContext): Promise<RecordPageView> {
    const objects = this.crm.forType(input.objectType);
    const isListing = input.query === undefined && (input.filterGroups ?? []).length === 0;

    context.logger.debug(
      { objectType: input.objectType, mode: isListing ? 'list' : 'search', limit: input.limit },
      'Querying HubSpot records.'
    );

    const page = isListing
      ? await objects.list({
          limit: input.limit,
          after: input.after,
          properties: input.properties,
          archived: input.archived,
        })
      : await objects.search({
          query: input.query,
          filterGroups: input.filterGroups,
          sorts: input.sorts,
          properties: input.properties,
          limit: input.limit,
          after: input.after,
        });

    return toRecordPageView(input.objectType, page, input.includeEmptyProperties);
  }
}
