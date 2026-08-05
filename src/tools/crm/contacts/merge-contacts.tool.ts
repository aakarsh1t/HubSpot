import { z } from 'zod';
import type { ContactsService } from '../../../services/contacts.service.js';
import {
  mergeContactsInputSchema,
  type MergeContactsInput,
} from '../../../schemas/contact.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const mergeOutputSchema = z.object({
  success: z.boolean(),
  primaryContactId: z.string().describe('The surviving contact ID.'),
  mergedContactId: z.string().describe('The contact that was absorbed and no longer exists.'),
  message: z.string(),
});

interface MergeResult {
  readonly success: boolean;
  readonly primaryContactId: string;
  readonly mergedContactId: string;
  readonly message: string;
}

/**
 * `hubspot_merge_contacts` — merges one contact into another.
 *
 * Irreversible through the API, so it carries the same literal-true
 * confirmation gate as permanent deletion, plus a schema-level check that the
 * two IDs differ (HubSpot's own error for a self-merge is unhelpful).
 *
 * Two behaviours worth knowing, both reflected in the response message:
 * the primary's property values win on conflict, and HubSpot processes the
 * merge **asynchronously** — a success here means "accepted", so an immediate
 * read-back may still show pre-merge state for a few seconds.
 *
 * @example
 * ```json
 * {
 *   "primaryContactId": "51234567890",
 *   "contactIdToMerge": "51234567891",
 *   "confirmMerge": true
 * }
 * ```
 */
export class MergeContactsTool
  implements ToolDefinition<typeof mergeContactsInputSchema, MergeResult>
{
  readonly name = 'hubspot_merge_contacts';
  readonly title = 'Merge HubSpot Contacts';
  readonly description =
    'Merge two duplicate HubSpot contacts into one. The primary contact survives and keeps its ' +
    'record ID; the other contact is absorbed into it and ceases to exist as a separate record. ' +
    'Where both contacts have a value for the same property, the primary contact wins. ' +
    'Associations and activities from both records are combined onto the primary. This cannot ' +
    'be undone through the API, so confirmMerge must be exactly true. HubSpot applies the merge ' +
    'asynchronously, so the change may take a few seconds to appear.';

  readonly inputSchema = mergeContactsInputSchema;
  readonly outputSchema = mergeOutputSchema;

  readonly annotations = {
    title: 'Merge HubSpot Contacts',
    readOnlyHint: false,
    // One of the two input records stops existing independently.
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(input: MergeContactsInput, context: ToolExecutionContext): Promise<MergeResult> {
    context.logger.warn(
      {
        primaryContactId: input.primaryContactId,
        contactIdToMerge: input.contactIdToMerge,
        irreversible: true,
      },
      'Merging HubSpot contacts.'
    );

    const merged = await this.contacts.merge(input.primaryContactId, input.contactIdToMerge);

    return {
      success: true,
      primaryContactId: merged.id,
      mergedContactId: input.contactIdToMerge,
      message:
        `Contact ${input.contactIdToMerge} was merged into ${merged.id}, which survives with ` +
        'its original ID. HubSpot processes merges asynchronously, so the combined record may ' +
        'take a few seconds to reflect all properties and activities. This cannot be undone.',
    };
  }
}
