import type { ContactsService } from '../../../services/contacts.service.js';
import {
  deleteContactInputSchema,
  operationResultSchema,
  type DeleteContactInput,
} from '../../../schemas/contact.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface DeleteResult {
  readonly success: boolean;
  readonly contactId: string | null;
  readonly message: string;
}

/**
 * `hubspot_delete_contact_permanently` — irreversible GDPR erasure.
 *
 * The most dangerous tool in this server, and it is deliberately awkward to
 * invoke. Three properties make it safe(r) to expose to an autonomous agent:
 *
 *  1. **A literal-true confirmation flag.** The model cannot reach this
 *     operation by paraphrase alone; the intent has to be stated explicitly in
 *     the tool call, where a human auditing the transcript can see it.
 *  2. **A name that cannot be confused with archiving.** An agent choosing
 *     between `archive_contact` and `delete_contact_permanently` for "delete
 *     this contact" has a clear, correct default.
 *  3. **`destructiveHint: true`**, so hosts that gate destructive tools behind
 *     human approval will do so.
 *
 * Unlike archiving, nothing survives: the record cannot be recovered by
 * HubSpot support, and the email address is blocklisted against re-creation.
 *
 * @example
 * ```json
 * { "contactId": "51234567890", "confirmPermanentDeletion": true }
 * ```
 */
export class DeleteContactTool implements ToolDefinition<
  typeof deleteContactInputSchema,
  DeleteResult
> {
  readonly name = 'hubspot_delete_contact_permanently';
  readonly title = 'Permanently Delete HubSpot Contact (GDPR)';
  readonly description =
    'PERMANENTLY and irreversibly delete a HubSpot contact using GDPR erasure. The contact and ' +
    'its history cannot be recovered by anyone, including HubSpot support, and the email address ' +
    'is added to a blocklist preventing it from being re-added to the portal. Requires ' +
    'confirmPermanentDeletion to be exactly true. Do NOT use this for ordinary deletion requests ' +
    '— use hubspot_archive_contact, which is reversible for 90 days. Only use this tool when the ' +
    'user has explicitly asked for permanent, GDPR-compliant erasure.';

  readonly inputSchema = deleteContactInputSchema;
  readonly outputSchema = operationResultSchema;

  readonly annotations = {
    title: 'Permanently Delete HubSpot Contact (GDPR)',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(input: DeleteContactInput, context: ToolExecutionContext): Promise<DeleteResult> {
    // Logged at warn with an explicit marker: permanent deletions must be
    // findable in an audit trail long after the conversation is gone.
    context.logger.warn(
      { contactId: input.contactId, operation: 'gdpr_permanent_delete', irreversible: true },
      'Permanently deleting HubSpot contact (GDPR erasure).'
    );

    await this.contacts.deletePermanently(input.contactId);

    return {
      success: true,
      contactId: input.contactId,
      message:
        `Contact ${input.contactId} has been PERMANENTLY deleted under GDPR erasure. This ` +
        'cannot be undone, and the associated email address is now blocklisted from being ' +
        're-added to this HubSpot portal.',
    };
  }
}
