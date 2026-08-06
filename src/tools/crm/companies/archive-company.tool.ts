import type { CompaniesService } from '../../../services/companies.service.js';
import {
  archiveCompanyInputSchema,
  companyOperationResultSchema,
  type ArchiveCompanyInput,
} from '../../../schemas/company.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface ArchiveResult {
  readonly success: boolean;
  readonly companyId: string | null;
  readonly message: string;
}

/**
 * `hubspot_archive_company` — soft-deletes a company.
 *
 * Recoverable from the UI recycle bin for 90 days. Permanent erasure is a
 * separate, gated tool (`hubspot_delete_company_permanently`).
 *
 * @example
 * ```json
 * { "companyId": "7801234567" }
 * ```
 */
export class ArchiveCompanyTool implements ToolDefinition<
  typeof archiveCompanyInputSchema,
  ArchiveResult
> {
  readonly name = 'hubspot_archive_company';
  readonly title = 'Archive HubSpot Company';
  readonly description =
    'Archive (soft-delete) a HubSpot company. The company is removed from the active CRM but ' +
    'remains recoverable from the HubSpot recycle bin for 90 days, and can still be read with ' +
    'the archived flag. This is the correct tool for a normal "delete this company" request. ' +
    'Only use hubspot_delete_company_permanently when irreversible GDPR erasure is explicitly ' +
    'required.';

  readonly inputSchema = archiveCompanyInputSchema;
  readonly outputSchema = companyOperationResultSchema;

  readonly annotations = {
    title: 'Archive HubSpot Company',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(input: ArchiveCompanyInput, context: ToolExecutionContext): Promise<ArchiveResult> {
    context.logger.warn({ companyId: input.companyId }, 'Archiving HubSpot company.');

    await this.companies.archive(input.companyId);

    return {
      success: true,
      companyId: input.companyId,
      message:
        `Company ${input.companyId} has been archived. It can be restored from the HubSpot ` +
        'recycle bin within 90 days, and remains readable via hubspot_get_company with archived ' +
        'set to true.',
    };
  }
}
