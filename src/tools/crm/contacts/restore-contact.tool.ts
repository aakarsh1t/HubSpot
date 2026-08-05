import type { ContactsService } from '../../../services/contacts.service.js';
import {
  restoreContactInputSchema,
  type RestoreContactInput,
} from '../../../schemas/contact.schema.js';
import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const restoreOutputSchema = z.object({
  success: z.boolean(),
  restoredAsNewRecord: z
    .boolean()
    .describe('Always true — HubSpot cannot restore in place, so a new record is created.'),
  originalContactId: z.string().describe('The archived contact that was used as the source.'),
  newContactId: z.string().describe('The ID of the newly created contact.'),
  propertiesCopied: z.number().describe('How many property values were carried over.'),
  notRestored: z
    .array(z.string())
    .describe('Things that were NOT recovered and must be rebuilt manually.'),
  message: z.string(),
});

interface RestoreResult {
  readonly success: boolean;
  readonly restoredAsNewRecord: boolean;
  readonly originalContactId: string;
  readonly newContactId: string;
  readonly propertiesCopied: number;
  readonly notRestored: string[];
  readonly message: string;
}

/**
 * `hubspot_restore_contact` — recreates an archived contact as a new record.
 *
 * **HubSpot has no un-archive API.** This is a verified platform limitation,
 * not an omission here: archived records can be *read* for 90 days
 * (`?archived=true`), but restoring one in place is only possible through the
 * UI recycle bin.
 *
 * Rather than omit the capability or pretend to restore, this tool performs
 * the only programmatic recovery that exists — read the archived snapshot and
 * create a new contact from its properties — and is explicit at every level
 * about what that does and does not recover:
 *
 *  - the tool description says it up front, so the orchestrator knows;
 *  - `confirmRecreate` forces the caller to acknowledge it;
 *  - the result carries `restoredAsNewRecord`, a new ID, and an explicit
 *    `notRestored` list.
 *
 * The alternative — silently returning "restored" after creating a different
 * record with a different ID — would corrupt downstream automation that keyed
 * on the original ID.
 *
 * @example
 * ```json
 * { "contactId": "51234567890", "confirmRecreate": true }
 * ```
 */
export class RestoreContactTool
  implements ToolDefinition<typeof restoreContactInputSchema, RestoreResult>
{
  readonly name = 'hubspot_restore_contact';
  readonly title = 'Restore Archived HubSpot Contact';
  readonly description =
    'Recover an archived (deleted) HubSpot contact. IMPORTANT: HubSpot provides no API to ' +
    'un-archive a record in place, so this reads the archived contact and recreates it as a ' +
    'NEW contact with a NEW record ID. Property values are copied; associations, notes, tasks, ' +
    'calls, meetings, emails, and timeline history are NOT recovered, and the original ID is ' +
    'not reused. Only works within 90 days of archiving. For a true in-place restore that keeps ' +
    'the original ID and all history, the user must use the HubSpot UI recycle bin ' +
    '(Contacts > Restore records). Requires confirmRecreate to be exactly true.';

  readonly inputSchema = restoreContactInputSchema;
  readonly outputSchema = restoreOutputSchema;

  readonly annotations = {
    title: 'Restore Archived HubSpot Contact',
    readOnlyHint: false,
    destructiveHint: false,
    // Calling twice produces two new contacts.
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(input: RestoreContactInput, context: ToolExecutionContext): Promise<RestoreResult> {
    context.logger.warn(
      { archivedContactId: input.contactId },
      'Recreating archived contact as a new record.'
    );

    const { created, sourceProperties } = await this.contacts.recreateFromArchive({
      contactId: input.contactId,
      properties: input.properties,
    });

    return {
      success: true,
      restoredAsNewRecord: true,
      originalContactId: input.contactId,
      newContactId: created.id,
      propertiesCopied: Object.keys(created.properties).filter(
        (key) => created.properties[key] !== null
      ).length,
      notRestored: [
        'The original record ID (the new contact has a different ID)',
        'Associations to companies, deals, and tickets',
        'Notes, tasks, calls, meetings, and logged emails',
        'Timeline and activity history',
        'Form submissions, email engagement, and page-view analytics',
      ],
      message:
        `Archived contact ${input.contactId} was recreated as NEW contact ${created.id} with ` +
        `${Object.keys(sourceProperties).length} source properties read. HubSpot has no ` +
        'un-archive API, so this is a new record: associations and all activity history were ' +
        'not recovered. For a true restore that preserves the original ID and history, use the ' +
        'HubSpot UI recycle bin within 90 days of deletion.',
    };
  }
}
