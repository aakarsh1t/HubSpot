import { z } from 'zod';
import { toRecordView, type RecordView } from './record-view.js';
import type { CrmService } from '../../services/crm.service.js';
import {
  recordOutputSchema,
  restoreRecordInputSchema,
  type RestoreRecordInput,
} from '../../schemas/crm.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

const restoreOutputSchema = z.object({
  success: z.boolean(),
  objectType: z.string(),
  archivedRecordId: z.string().describe('The archived record that was read.'),
  newRecordId: z.string().describe('The NEW record created from it. The old ID stays archived.'),
  record: recordOutputSchema,
  restoredPropertyCount: z.number(),
  message: z.string(),
});

interface RestoreResult {
  readonly success: boolean;
  readonly objectType: string;
  readonly archivedRecordId: string;
  readonly newRecordId: string;
  readonly record: RecordView;
  readonly restoredPropertyCount: number;
  readonly message: string;
}

/**
 * `hubspot_restore_record` — recreates a record from its archived snapshot.
 *
 * HubSpot exposes **no un-archive endpoint** for any object type, so this is
 * the only programmatic recovery available and it is not a true restore: the
 * result is a new record with a new ID, and associations, engagements, and
 * timeline history do not come back. Both the description and the returned
 * message say so plainly, because an agent reporting "restored" to a user who
 * then goes looking for the original ID is the failure mode that matters here.
 */
export class RestoreRecordTool implements ToolDefinition<
  typeof restoreRecordInputSchema,
  RestoreResult
> {
  readonly name = 'hubspot_restore_record';
  readonly title = 'Restore Archived HubSpot Record';
  readonly description =
    'Recreate an archived HubSpot contact, company, or deal from its archived snapshot. HubSpot ' +
    'has no un-archive API, so this creates a NEW record with a NEW ID carrying the old ' +
    'property values — associations, activities, and timeline history are NOT restored, and the ' +
    'original archived record stays archived. For a true in-place restore, use the HubSpot UI ' +
    'recycle bin within 90 days. Requires confirmRecreate: true.';

  readonly inputSchema = restoreRecordInputSchema;
  readonly outputSchema = restoreOutputSchema;

  readonly annotations = {
    title: 'Restore Archived HubSpot Record',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly crm: CrmService;

  constructor(crm: CrmService) {
    this.crm = crm;
  }

  async execute(input: RestoreRecordInput, context: ToolExecutionContext): Promise<RestoreResult> {
    const outcome = await this.crm.forType(input.objectType).recreateFromArchive({
      id: input.recordId,
      properties: input.properties,
    });

    context.logger.warn(
      {
        objectType: input.objectType,
        archivedRecordId: input.recordId,
        newRecordId: outcome.created.id,
      },
      'Recreated HubSpot record from archived snapshot.'
    );

    return {
      success: true,
      objectType: input.objectType,
      archivedRecordId: input.recordId,
      newRecordId: outcome.created.id,
      record: toRecordView(outcome.created, { includeEmptyProperties: false }),
      restoredPropertyCount: Object.keys(outcome.created.properties).length,
      message:
        `Created a NEW record ${outcome.created.id} from the archived snapshot of ` +
        `${input.recordId}. Associations, activities, and timeline history were not restored, ` +
        `and ${input.recordId} remains archived. Report the new ID to the user.`,
    };
  }
}
