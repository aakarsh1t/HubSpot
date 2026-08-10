import { z } from 'zod';
import { toRecordView, type RecordView } from './record-view.js';
import type { CrmService } from '../../services/crm.service.js';
import {
  mergeRecordsInputSchema,
  recordOutputSchema,
  type MergeRecordsInput,
} from '../../schemas/crm.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

const mergeOutputSchema = z.object({
  success: z.boolean(),
  objectType: z.string(),
  survivingRecordId: z.string(),
  mergedRecordId: z.string(),
  record: recordOutputSchema,
  message: z.string(),
});

interface MergeResult {
  readonly success: boolean;
  readonly objectType: string;
  readonly survivingRecordId: string;
  readonly mergedRecordId: string;
  readonly record: RecordView;
  readonly message: string;
}

/**
 * `hubspot_merge_records` — merges two records of the same type.
 *
 * Irreversible through the API, and asymmetric: which record you name primary
 * decides which ID survives and whose property values win on conflict. The
 * schema rejects merging a record into itself and requires `confirmMerge`.
 */
export class MergeRecordsTool implements ToolDefinition<
  typeof mergeRecordsInputSchema,
  MergeResult
> {
  readonly name = 'hubspot_merge_records';
  readonly title = 'Merge HubSpot Records';
  readonly description =
    'Merge two HubSpot records of the same object type into one. The primary record survives, ' +
    'keeps its ID, and its property values win on conflict; the other record is absorbed and ' +
    'ceases to exist separately. Associations and activities move to the primary. This cannot be ' +
    'undone through the API and requires confirmMerge: true. Use it to resolve duplicates found ' +
    'with hubspot_search_records.';

  readonly inputSchema = mergeRecordsInputSchema;
  readonly outputSchema = mergeOutputSchema;

  readonly annotations = {
    title: 'Merge HubSpot Records',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly crm: CrmService;

  constructor(crm: CrmService) {
    this.crm = crm;
  }

  async execute(input: MergeRecordsInput, context: ToolExecutionContext): Promise<MergeResult> {
    const record = await this.crm
      .forType(input.objectType)
      .merge(input.primaryRecordId, input.recordIdToMerge);

    context.logger.warn(
      {
        objectType: input.objectType,
        primaryRecordId: input.primaryRecordId,
        recordIdToMerge: input.recordIdToMerge,
      },
      'Merged HubSpot records.'
    );

    return {
      success: true,
      objectType: input.objectType,
      survivingRecordId: record.id,
      mergedRecordId: input.recordIdToMerge,
      record: toRecordView(record, { includeEmptyProperties: false }),
      message:
        `Merged ${input.recordIdToMerge} into ${record.id}. ${input.recordIdToMerge} no longer ` +
        'exists as a separate record.',
    };
  }
}
