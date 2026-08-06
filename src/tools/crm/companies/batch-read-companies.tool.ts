import type { CompaniesService } from '../../../services/companies.service.js';
import {
  batchReadCompaniesInputSchema,
  companyBatchOutcomeOutputSchema,
  type BatchReadCompaniesInput,
} from '../../../schemas/company.schema.js';
import type { BatchOutcome, CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_batch_read_companies` — reads up to 100 companies in one call.
 *
 * Always prefer this over calling `hubspot_get_company` repeatedly when
 * several companies are needed — one API call instead of many.
 *
 * @example
 * ```json
 * { "companyIds": ["7801234567", "7801234568"] }
 * ```
 */
export class BatchReadCompaniesTool implements ToolDefinition<
  typeof batchReadCompaniesInputSchema,
  BatchOutcome<CrmObject>
> {
  readonly name = 'hubspot_batch_read_companies';
  readonly title = 'Batch Read HubSpot Companies';
  readonly description =
    'Retrieve up to 100 HubSpot companies in a single request, by record ID. Always prefer this ' +
    'over calling hubspot_get_company repeatedly when you need several companies. IDs that do ' +
    'not exist are reported in the errors array rather than failing the whole request.';

  readonly inputSchema = batchReadCompaniesInputSchema;
  readonly outputSchema = companyBatchOutcomeOutputSchema;

  readonly annotations = {
    title: 'Batch Read HubSpot Companies',
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
    input: BatchReadCompaniesInput,
    context: ToolExecutionContext
  ): Promise<BatchOutcome<CrmObject>> {
    context.logger.debug({ count: input.companyIds.length }, 'Batch reading HubSpot companies.');
    return this.companies.batchRead(input);
  }
}
