import type { ContactsService } from '../../../services/contacts.service.js';
import {
  contactPageOutputSchema,
  searchContactsInputSchema,
  type SearchContactsInput,
} from '../../../schemas/contact.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface SearchResult {
  readonly results: readonly CrmObject[];
  readonly after: string | null;
  readonly total: number | null;
  readonly count: number;
}

/**
 * `hubspot_search_contacts` — filtered search over contacts.
 *
 * The schema carries HubSpot's real constraints (5 filter groups, 6 filters
 * each, 18 total, limit ≤ 200) and validates operator/argument pairings before
 * any network call. That turns the most common failure mode — an opaque
 * HubSpot 400 for, say, `IN` without `values` — into a precise local message
 * the agent can act on and retry correctly.
 *
 * @example Free-text
 * ```json
 * { "query": "acme.com", "limit": 10 }
 * ```
 *
 * @example AND within a group
 * ```json
 * {
 *   "filterGroups": [{ "filters": [
 *     { "propertyName": "lifecyclestage", "operator": "EQ", "value": "lead" },
 *     { "propertyName": "createdate", "operator": "GTE", "value": "2026-01-01" }
 *   ]}],
 *   "sorts": [{ "propertyName": "createdate", "direction": "DESCENDING" }]
 * }
 * ```
 *
 * @example OR across groups
 * ```json
 * {
 *   "filterGroups": [
 *     { "filters": [{ "propertyName": "hs_lead_status", "operator": "EQ", "value": "NEW" }] },
 *     { "filters": [{ "propertyName": "hs_lead_status", "operator": "EQ", "value": "OPEN" }] }
 *   ]
 * }
 * ```
 *
 * @example Partial match
 * ```json
 * { "filterGroups": [{ "filters": [
 *   { "propertyName": "email", "operator": "CONTAINS_TOKEN", "value": "*@acme.com" }
 * ]}]}
 * ```
 */
export class SearchContactsTool
  implements ToolDefinition<typeof searchContactsInputSchema, SearchResult>
{
  readonly name = 'hubspot_search_contacts';
  readonly title = 'Search HubSpot Contacts';
  readonly description =
    'Search HubSpot contacts by property values or free text. Use filterGroups for structured ' +
    'criteria: filters inside one group are combined with AND, and separate groups are combined ' +
    'with OR. Operators: EQ, NEQ, LT, LTE, GT, GTE, BETWEEN (needs value and highValue), ' +
    'IN and NOT_IN (need a values array), HAS_PROPERTY, NOT_HAS_PROPERTY, CONTAINS_TOKEN and ' +
    'NOT_CONTAINS_TOKEN (word matching, supports * wildcards). HubSpot limits: 5 filter groups, ' +
    '6 filters each, 18 total, and 200 results per page. Prefer hubspot_get_contact_by_email ' +
    'for an exact email lookup, and hubspot_list_contacts when you have no criteria at all.';

  readonly inputSchema = searchContactsInputSchema;
  readonly outputSchema = contactPageOutputSchema;

  readonly annotations = {
    title: 'Search HubSpot Contacts',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(input: SearchContactsInput, context: ToolExecutionContext): Promise<SearchResult> {
    context.logger.debug(
      {
        hasQuery: input.query !== undefined,
        filterGroups: input.filterGroups?.length ?? 0,
        limit: input.limit,
      },
      'Searching HubSpot contacts.'
    );

    const page = await this.contacts.search(input);

    return { ...page, count: page.results.length };
  }
}
