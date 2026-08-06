import { z } from 'zod';
import type { CompaniesService } from '../../../services/companies.service.js';
import {
  mergeCompaniesInputSchema,
  type MergeCompaniesInput,
} from '../../../schemas/company.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const mergeOutputSchema = z.object({
  success: z.boolean(),
  primaryCompanyId: z.string(),
  mergedCompanyId: z.string(),
  message: z.string(),
});

interface MergeResult {
  readonly success: boolean;
  readonly primaryCompanyId: string;
  readonly mergedCompanyId: string;
  readonly message: string;
}

/**
 * `hubspot_merge_companies` — merges one company into another.
 *
 * Irreversible through the API. Carries the same literal-true confirmation
 * gate and self-merge guard as `hubspot_merge_contacts`.
 *
 * @example
 * ```json
 * { "primaryCompanyId": "7801234567", "companyIdToMerge": "7801234568", "confirmMerge": true }
 * ```
 */
export class MergeCompaniesTool implements ToolDefinition<
  typeof mergeCompaniesInputSchema,
  MergeResult
> {
  readonly name = 'hubspot_merge_companies';
  readonly title = 'Merge HubSpot Companies';
  readonly description =
    'Merge two duplicate HubSpot companies into one. The primary company survives and keeps its ' +
    'record ID; the other company is absorbed into it and ceases to exist as a separate record. ' +
    'Where both companies have a value for the same property, the primary wins. Associations and ' +
    'activities from both records are combined onto the primary. This cannot be undone through ' +
    'the API, so confirmMerge must be exactly true. HubSpot applies the merge asynchronously.';

  readonly inputSchema = mergeCompaniesInputSchema;
  readonly outputSchema = mergeOutputSchema;

  readonly annotations = {
    title: 'Merge HubSpot Companies',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly companies: CompaniesService;

  constructor(companies: CompaniesService) {
    this.companies = companies;
  }

  async execute(input: MergeCompaniesInput, context: ToolExecutionContext): Promise<MergeResult> {
    context.logger.warn(
      {
        primaryCompanyId: input.primaryCompanyId,
        companyIdToMerge: input.companyIdToMerge,
        irreversible: true,
      },
      'Merging HubSpot companies.'
    );

    const merged = await this.companies.merge(input.primaryCompanyId, input.companyIdToMerge);

    return {
      success: true,
      primaryCompanyId: merged.id,
      mergedCompanyId: input.companyIdToMerge,
      message:
        `Company ${input.companyIdToMerge} was merged into ${merged.id}, which survives with ` +
        'its original ID. HubSpot processes merges asynchronously. This cannot be undone.',
    };
  }
}
