import type { CompaniesService } from '../../../services/companies.service.js';
import {
  companyOutputSchema,
  updateCompanyInputSchema,
  type UpdateCompanyInput,
} from '../../../schemas/company.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_update_company` — updates properties on an existing company.
 *
 * PATCH semantics: only the supplied properties change. Passing `null`
 * clears a property. Idempotent — safe to retry.
 *
 * @example
 * ```json
 * { "companyId": "7801234567", "properties": { "lifecyclestage": "customer" } }
 * ```
 */
export class UpdateCompanyTool implements ToolDefinition<
  typeof updateCompanyInputSchema,
  CrmObject
> {
  readonly name = 'hubspot_update_company';
  readonly title = 'Update HubSpot Company';
  readonly description =
    'Update one or more properties on an existing HubSpot company, identified by its record ID. ' +
    'Only the properties you supply are changed; all others are left untouched. Pass null as a ' +
    'value to clear a property. Use hubspot_search_companies first if you know the domain but ' +
    'not the company ID. Returns the updated company.';

  readonly inputSchema = updateCompanyInputSchema;
  readonly outputSchema = companyOutputSchema;

  readonly annotations = {
    title: 'Update HubSpot Company',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(input: UpdateCompanyInput, context: ToolExecutionContext): Promise<CrmObject> {
    context.logger.debug(
      { companyId: input.companyId, properties: Object.keys(input.properties) },
      'Updating HubSpot company.'
    );

    return this.companies.update(input);
  }
}
