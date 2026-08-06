import type { CompaniesService } from '../../../services/companies.service.js';
import {
  companyPageOutputSchema,
  searchCompaniesInputSchema,
  type SearchCompaniesInput,
} from '../../../schemas/company.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface SearchResult {
  readonly results: readonly CrmObject[];
  readonly after: string | null;
  readonly total: number | null;
  readonly count: number;
}

/**
 * `hubspot_search_companies` — filtered search over companies.
 *
 * This is also the **reliable way to look up a company by domain**: HubSpot's
 * single-object `idProperty=domain` lookup (the pattern used for contact
 * email lookups) is community-reported as unreliable for companies, so no
 * dedicated `getCompanyByDomain` tool is offered — use a `domain` EQ filter
 * here instead, which goes through the properly indexed search API.
 *
 * @example Lookup by domain
 * ```json
 * { "filterGroups": [{ "filters": [
 *   { "propertyName": "domain", "operator": "EQ", "value": "acme.com" }
 * ]}]}
 * ```
 *
 * @example Free-text
 * ```json
 * { "query": "acme", "limit": 10 }
 * ```
 */
export class SearchCompaniesTool implements ToolDefinition<
  typeof searchCompaniesInputSchema,
  SearchResult
> {
  readonly name = 'hubspot_search_companies';
  readonly title = 'Search HubSpot Companies';
  readonly description =
    'Search HubSpot companies by property values or free text. This is the reliable way to find ' +
    'a company by domain: use a filterGroup with a "domain" EQ filter. Use filterGroups for ' +
    'structured criteria: filters inside one group are combined with AND, and separate groups ' +
    'are combined with OR. Operators: EQ, NEQ, LT, LTE, GT, GTE, BETWEEN (needs value and ' +
    'highValue), IN and NOT_IN (need a values array), HAS_PROPERTY, NOT_HAS_PROPERTY, ' +
    'CONTAINS_TOKEN and NOT_CONTAINS_TOKEN (word matching, supports * wildcards). HubSpot ' +
    'limits: 5 filter groups, 6 filters each, 18 total, and 200 results per page.';

  readonly inputSchema = searchCompaniesInputSchema;
  readonly outputSchema = companyPageOutputSchema;

  readonly annotations = {
    title: 'Search HubSpot Companies',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(input: SearchCompaniesInput, context: ToolExecutionContext): Promise<SearchResult> {
    context.logger.debug(
      { hasQuery: input.query !== undefined, filterGroups: input.filterGroups?.length ?? 0 },
      'Searching HubSpot companies.'
    );

    const page = await this.companies.search(input);
    return { ...page, count: page.results.length };
  }
}
