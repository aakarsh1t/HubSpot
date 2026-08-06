import type { CompaniesService } from '../../../services/companies.service.js';
import {
  batchUpdateCompaniesInputSchema,
  companyBatchOutcomeOutputSchema,
  type BatchUpdateCompaniesInput,
} from '../../../schemas/company.schema.js';
import type { BatchOutcome, CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_batch_update_companies` — updates up to 100 companies per call.
 *
 * Each entry is addressed by record ID with PATCH semantics, so the whole
 * batch is idempotent and safe to retry.
 *
 * @example
 * ```json
 * {
 *   "companies": [
 *     { "companyId": "7801234567", "properties": { "lifecyclestage": "customer" } }
 *   ]
 * }
 * ```
 */
export class BatchUpdateCompaniesTool implements ToolDefinition<
  typeof batchUpdateCompaniesInputSchema,
  BatchOutcome<CrmObject>
> {
  readonly name = 'hubspot_batch_update_companies';
  readonly title = 'Batch Update HubSpot Companies';
  readonly description =
    'Update up to 100 existing HubSpot companies in a single request. Each entry needs a ' +
    'company ID and the properties to change; unlisted properties are left untouched. Check the ' +
    'returned status, succeeded/failed counts, and errors array.';

  readonly inputSchema = batchUpdateCompaniesInputSchema;
  readonly outputSchema = companyBatchOutcomeOutputSchema;

  readonly annotations = {
    title: 'Batch Update HubSpot Companies',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(
    input: BatchUpdateCompaniesInput,
    context: ToolExecutionContext
  ): Promise<BatchOutcome<CrmObject>> {
    context.logger.info({ count: input.companies.length }, 'Batch updating HubSpot companies.');

    const outcome = await this.companies.batchUpdate(input);

    if (outcome.failed > 0) {
      context.logger.warn(
        { requested: outcome.requested, succeeded: outcome.succeeded, failed: outcome.failed },
        'Batch company update completed with failures.'
      );
    }

    return outcome;
  }
}
