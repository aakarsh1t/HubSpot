import type { CompaniesService } from '../../../services/companies.service.js';
import {
  companyOperationResultSchema,
  deleteCompanyInputSchema,
  type DeleteCompanyInput,
} from '../../../schemas/company.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface DeleteResult {
  readonly success: boolean;
  readonly companyId: string | null;
  readonly message: string;
}

/**
 * `hubspot_delete_company_permanently` — irreversible GDPR erasure.
 *
 * Gated the same way as its Contacts counterpart: a literal-true
 * confirmation the model must state explicitly, an unambiguous name distinct
 * from archiving, and `destructiveHint: true` for hosts that gate destructive
 * tools behind human approval.
 *
 * @example
 * ```json
 * { "companyId": "7801234567", "confirmPermanentDeletion": true }
 * ```
 */
export class DeleteCompanyTool implements ToolDefinition<
  typeof deleteCompanyInputSchema,
  DeleteResult
> {
  readonly name = 'hubspot_delete_company_permanently';
  readonly title = 'Permanently Delete HubSpot Company (GDPR)';
  readonly description =
    'PERMANENTLY and irreversibly delete a HubSpot company using GDPR erasure. The company and ' +
    'its history cannot be recovered by anyone, including HubSpot support. Requires ' +
    'confirmPermanentDeletion to be exactly true. Do NOT use this for ordinary deletion requests ' +
    '— use hubspot_archive_company, which is reversible for 90 days. Only use this tool when the ' +
    'user has explicitly asked for permanent, GDPR-compliant erasure.';

  readonly inputSchema = deleteCompanyInputSchema;
  readonly outputSchema = companyOperationResultSchema;

  readonly annotations = {
    title: 'Permanently Delete HubSpot Company (GDPR)',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(input: DeleteCompanyInput, context: ToolExecutionContext): Promise<DeleteResult> {
    context.logger.warn(
      { companyId: input.companyId, operation: 'gdpr_permanent_delete', irreversible: true },
      'Permanently deleting HubSpot company (GDPR erasure).'
    );

    await this.companies.deletePermanently(input.companyId);

    return {
      success: true,
      companyId: input.companyId,
      message: `Company ${input.companyId} has been PERMANENTLY deleted under GDPR erasure. This cannot be undone.`,
    };
  }
}
