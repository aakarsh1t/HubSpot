import type { CrmService } from '../../services/crm.service.js';
import {
  deleteRecordInputSchema,
  operationResultSchema,
  type DeleteRecordInput,
} from '../../schemas/crm.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

interface DeleteResult {
  readonly success: boolean;
  readonly objectType: string;
  readonly recordId: string;
  readonly message: string;
}

/**
 * `hubspot_delete_record` — archives or permanently erases a record.
 *
 * Replaces six tools (`archive_*` and `delete_*_permanently` across three
 * object types) with one, because they are the same decision with two answers.
 * Making that the `mode` parameter rather than the tool name puts the choice
 * where the agent must state it explicitly, and keeps the irreversible answer
 * behind `confirmPermanentDeletion` — enforced by the schema, so a
 * paraphrase like "get rid of this contact" cannot reach the erasure path.
 */
export class DeleteRecordTool implements ToolDefinition<
  typeof deleteRecordInputSchema,
  DeleteResult
> {
  readonly name = 'hubspot_delete_record';
  readonly title = 'Delete HubSpot Record';
  readonly description =
    'Delete a HubSpot contact, company, or deal. mode "archive" (the default) is a soft delete: ' +
    'the record leaves active views and is recoverable from the HubSpot recycle bin for 90 days. ' +
    'mode "permanent" is a GDPR erasure — irreversible, destroys the record history, and for a ' +
    'contact blocklists the email address so it can never be re-added; it requires ' +
    'confirmPermanentDeletion: true. Prefer archive unless permanent erasure was explicitly asked for.';

  readonly inputSchema = deleteRecordInputSchema;
  readonly outputSchema = operationResultSchema;

  readonly annotations = {
    title: 'Delete HubSpot Record',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly crm: CrmService;

  constructor(crm: CrmService) {
    this.crm = crm;
  }

  async execute(input: DeleteRecordInput, context: ToolExecutionContext): Promise<DeleteResult> {
    const objects = this.crm.forType(input.objectType);
    const noun = singular(input.objectType);

    if (input.mode === 'permanent') {
      await objects.deletePermanently(input.recordId);

      context.logger.warn(
        { objectType: input.objectType, recordId: input.recordId },
        'Permanently deleted HubSpot record.'
      );

      return {
        success: true,
        objectType: input.objectType,
        recordId: input.recordId,
        message:
          `Permanently deleted ${noun} ${input.recordId}. This cannot be undone and the record ` +
          'is not in the recycle bin.',
      };
    }

    await objects.archive(input.recordId);

    context.logger.warn(
      { objectType: input.objectType, recordId: input.recordId },
      'Archived HubSpot record.'
    );

    return {
      success: true,
      objectType: input.objectType,
      recordId: input.recordId,
      message:
        `Archived ${noun} ${input.recordId}. It is recoverable from the HubSpot recycle bin for ` +
        '90 days; hubspot_restore_record can recreate it as a new record.',
    };
  }
}

function singular(objectType: string): string {
  return objectType.replace(/ies$/u, 'y').replace(/s$/u, '');
}
