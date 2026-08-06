import type { CompaniesService } from '../../../services/companies.service.js';
import {
  companyOutputSchema,
  createCompanyInputSchema,
  type CreateCompanyInput,
} from '../../../schemas/company.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_create_company` — creates a single company.
 *
 * Not idempotent: the underlying request is marked non-retryable so a
 * transient failure can never produce a duplicate record.
 *
 * @example Minimal
 * ```json
 * { "properties": { "name": "Acme Corp", "domain": "acme.com" } }
 * ```
 *
 * @example With associations
 * ```json
 * {
 *   "properties": { "name": "Acme Corp", "domain": "acme.com", "industry": "SOFTWARE" },
 *   "associations": [{ "toObjectType": "contacts", "toObjectId": "512" }]
 * }
 * ```
 */
export class CreateCompanyTool implements ToolDefinition<
  typeof createCompanyInputSchema,
  CrmObject
> {
  readonly name = 'hubspot_create_company';
  readonly title = 'Create HubSpot Company';
  readonly description =
    'Create a new company in HubSpot. Supply company fields as a properties object using ' +
    'HubSpot internal property names (name, domain, website, industry, city, state, ' +
    'numberofemployees, annualrevenue, lifecyclestage, and any custom properties). Optionally ' +
    'associate the new company with existing contacts, deals, or tickets. Returns the created ' +
    'company including its new ID. Use hubspot_update_company instead if the company already exists.';

  readonly inputSchema = createCompanyInputSchema;
  readonly outputSchema = companyOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Company',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(input: CreateCompanyInput, context: ToolExecutionContext): Promise<CrmObject> {
    context.logger.debug(
      { propertyCount: Object.keys(input.properties).length },
      'Creating HubSpot company.'
    );

    return this.companies.create(input);
  }
}
