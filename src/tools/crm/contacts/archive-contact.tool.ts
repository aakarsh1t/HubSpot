import type { ContactsService } from '../../../services/contacts.service.js';
import {
  archiveContactInputSchema,
  operationResultSchema,
  type ArchiveContactInput,
} from '../../../schemas/contact.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface ArchiveResult {
  readonly success: boolean;
  readonly contactId: string | null;
  readonly message: string;
}

/**
 * `hubspot_archive_contact` — soft-deletes a contact.
 *
 * This is what HubSpot's `DELETE` actually does, and it is the operation
 * almost every "delete this contact" request really wants: the record leaves
 * the active CRM but stays recoverable from the UI recycle bin for 90 days,
 * and remains readable through `hubspot_get_contact` with `archived: true`.
 *
 * Permanent erasure is a separate, gated tool
 * (`hubspot_delete_contact_permanently`).
 *
 * @example
 * ```json
 * { "contactId": "51234567890" }
 * ```
 */
export class ArchiveContactTool
  implements ToolDefinition<typeof archiveContactInputSchema, ArchiveResult>
{
  readonly name = 'hubspot_archive_contact';
  readonly title = 'Archive HubSpot Contact';
  readonly description =
    'Archive (soft-delete) a HubSpot contact. The contact is removed from the active CRM but ' +
    'remains recoverable from the HubSpot recycle bin for 90 days, and can still be read with ' +
    'the archived flag. This is the correct tool for a normal "delete this contact" request. ' +
    'Only use hubspot_delete_contact_permanently when irreversible GDPR erasure is explicitly ' +
    'required.';

  readonly inputSchema = archiveContactInputSchema;
  readonly outputSchema = operationResultSchema;

  readonly annotations = {
    title: 'Archive HubSpot Contact',
    readOnlyHint: false,
    // Removes the record from the active CRM, even though it is recoverable.
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(input: ArchiveContactInput, context: ToolExecutionContext): Promise<ArchiveResult> {
    context.logger.warn({ contactId: input.contactId }, 'Archiving HubSpot contact.');

    await this.contacts.archive(input.contactId);

    return {
      success: true,
      contactId: input.contactId,
      message:
        `Contact ${input.contactId} has been archived. It can be restored from the HubSpot ` +
        'recycle bin within 90 days, and remains readable via hubspot_get_contact with ' +
        'archived set to true.',
    };
  }
}
