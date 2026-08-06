import { z } from 'zod';
import type { CompaniesService } from '../../../services/companies.service.js';
import {
  batchArchiveCompaniesInputSchema,
  type BatchArchiveCompaniesInput,
} from '../../../schemas/company.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const batchArchiveOutputSchema = z.object({
  success: z.boolean(),
  archivedCount: z.number(),
  companyIds: z.array(z.string()),
  message: z.string(),
});

interface BatchArchiveResult {
  readonly success: boolean;
  readonly archivedCount: number;
  readonly companyIds: readonly string[];
  readonly message: string;
}

/**
 * `hubspot_batch_archive_companies` — archives up to 100 companies per call.
 *
 * Bulk destruction is high blast-radius, so it carries the same
 * literal-true confirmation gate as the single-record destructive tools.
 * Archiving remains reversible for 90 days via the UI.
 *
 * @example
 * ```json
 * { "companyIds": ["7801234567", "7801234568"], "confirmArchive": true }
 * ```
 */
export class BatchArchiveCompaniesTool implements ToolDefinition<
  typeof batchArchiveCompaniesInputSchema,
  BatchArchiveResult
> {
  readonly name = 'hubspot_batch_archive_companies';
  readonly title = 'Batch Archive HubSpot Companies';
  readonly description =
    'Archive (soft-delete) up to 100 HubSpot companies in a single request. Archived companies ' +
    'leave the active CRM but stay recoverable from the HubSpot recycle bin for 90 days. ' +
    'Requires confirmArchive to be exactly true because this affects many records at once. ' +
    'Always confirm the exact list of company IDs with the user before calling this.';

  readonly inputSchema = batchArchiveCompaniesInputSchema;
  readonly outputSchema = batchArchiveOutputSchema;

  readonly annotations = {
    title: 'Batch Archive HubSpot Companies',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(
    input: BatchArchiveCompaniesInput,
    context: ToolExecutionContext
  ): Promise<BatchArchiveResult> {
    context.logger.warn(
      { count: input.companyIds.length, companyIds: input.companyIds },
      'Batch archiving HubSpot companies.'
    );

    const archivedCount = await this.companies.batchArchive(input.companyIds);

    return {
      success: true,
      archivedCount,
      companyIds: input.companyIds,
      message: `${archivedCount} company(ies) archived. They can be restored from the HubSpot recycle bin within 90 days.`,
    };
  }
}
