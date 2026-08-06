import type { CompaniesService } from '../../../services/companies.service.js';
import {
  companyPageOutputSchema,
  listCompaniesInputSchema,
  type ListCompaniesInput,
} from '../../../schemas/company.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface CompanyPageResult {
  readonly results: readonly CrmObject[];
  readonly after: string | null;
  readonly total: number | null;
  readonly count: number;
}

/**
 * `hubspot_list_companies` — pages through companies without search criteria.
 *
 * @example First page
 * ```json
 * { "limit": 25 }
 * ```
 */
export class ListCompaniesTool implements ToolDefinition<
  typeof listCompaniesInputSchema,
  CompanyPageResult
> {
  readonly name = 'hubspot_list_companies';
  readonly title = 'List HubSpot Companies';
  readonly description =
    'List HubSpot companies page by page, without any search criteria. Returns up to 100 per ' +
    'call along with an "after" cursor; pass that cursor back to fetch the next page, and stop ' +
    'when it is null. Use hubspot_search_companies instead when you need to filter by property ' +
    'values (including looking up a company by domain). Set archived to true to list deleted ' +
    'companies.';

  readonly inputSchema = listCompaniesInputSchema;
  readonly outputSchema = companyPageOutputSchema;

  readonly annotations = {
    title: 'List HubSpot Companies',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(
    input: ListCompaniesInput,
    context: ToolExecutionContext
  ): Promise<CompanyPageResult> {
    context.logger.debug(
      { limit: input.limit, archived: input.archived },
      'Listing HubSpot companies.'
    );

    const page = await this.companies.list(input);
    return { ...page, count: page.results.length };
  }
}
