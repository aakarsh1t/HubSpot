import type { CompaniesService } from '../../../services/companies.service.js';
import {
  batchCreateCompaniesInputSchema,
  companyBatchOutcomeOutputSchema,
  type BatchCreateCompaniesInput,
} from '../../../schemas/company.schema.js';
import type { BatchOutcome, CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_batch_create_companies` — creates up to 100 companies per call.
 *
 * HubSpot answers a mixed batch with HTTP 207; the response always states
 * `requested`/`succeeded`/`failed` and a `status` of COMPLETE / PARTIAL /
 * ERROR so a caller cannot mistake a partial failure for a clean success.
 *
 * @example
 * ```json
 * {
 *   "companies": [
 *     { "properties": { "name": "Acme Corp", "domain": "acme.com" } },
 *     { "properties": { "name": "Beta LLC", "domain": "beta.io" } }
 *   ]
 * }
 * ```
 */
export class BatchCreateCompaniesTool implements ToolDefinition<
  typeof batchCreateCompaniesInputSchema,
  BatchOutcome<CrmObject>
> {
  readonly name = 'hubspot_batch_create_companies';
  readonly title = 'Batch Create HubSpot Companies';
  readonly description =
    'Create up to 100 HubSpot companies in a single request. Individual records can fail while ' +
    'others succeed, so always check the returned status (COMPLETE, PARTIAL, or ERROR) together ' +
    'with the succeeded and failed counts and the errors array.';

  readonly inputSchema = batchCreateCompaniesInputSchema;
  readonly outputSchema = companyBatchOutcomeOutputSchema;

  readonly annotations = {
    title: 'Batch Create HubSpot Companies',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(
    input: BatchCreateCompaniesInput,
    context: ToolExecutionContext
  ): Promise<BatchOutcome<CrmObject>> {
    context.logger.info({ count: input.companies.length }, 'Batch creating HubSpot companies.');

    const outcome = await this.companies.batchCreate(input);

    if (outcome.failed > 0) {
      context.logger.warn(
        { requested: outcome.requested, succeeded: outcome.succeeded, failed: outcome.failed },
        'Batch company creation completed with failures.'
      );
    }

    return outcome;
  }
}
