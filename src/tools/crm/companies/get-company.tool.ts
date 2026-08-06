import { z } from 'zod';
import type { CompaniesService } from '../../../services/companies.service.js';
import {
  companyOutputSchema,
  getCompanyInputSchema,
  type GetCompanyInput,
} from '../../../schemas/company.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const getCompanyOutputSchema = companyOutputSchema.extend({
  associations: z
    .record(z.string(), z.array(z.string()))
    .describe('Associated record IDs keyed by object type, when requested.'),
});

interface GetCompanyResult {
  readonly id: string;
  readonly properties: Record<string, string | null>;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly archived: boolean;
  readonly associations: Record<string, string[]>;
}

/**
 * `hubspot_get_company` — reads one company by record ID.
 *
 * Can also read archived records within their 90-day window.
 *
 * @example
 * ```json
 * { "companyId": "7801234567", "includeAssociations": ["contacts", "deals"] }
 * ```
 */
export class GetCompanyTool implements ToolDefinition<
  typeof getCompanyInputSchema,
  GetCompanyResult
> {
  readonly name = 'hubspot_get_company';
  readonly title = 'Get HubSpot Company by ID';
  readonly description =
    'Retrieve a single HubSpot company by its numeric record ID. Optionally request specific ' +
    'properties and the IDs of associated contacts, deals, tickets, or activities. Set archived ' +
    'to true to read a company that has been deleted (readable for 90 days after archiving). ' +
    'If you only know the domain, use hubspot_search_companies with a domain filter instead.';

  readonly inputSchema = getCompanyInputSchema;
  readonly outputSchema = getCompanyOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Company by ID',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(input: GetCompanyInput, context: ToolExecutionContext): Promise<GetCompanyResult> {
    context.logger.debug(
      { companyId: input.companyId, archived: input.archived },
      'Reading HubSpot company.'
    );

    return this.companies.getById({
      companyId: input.companyId,
      properties: input.properties,
      associations: input.includeAssociations,
      archived: input.archived,
    });
  }
}
