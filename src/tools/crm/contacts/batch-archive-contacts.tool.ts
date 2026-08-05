import { z } from 'zod';
import type { ContactsService } from '../../../services/contacts.service.js';
import {
  batchArchiveContactsInputSchema,
  type BatchArchiveContactsInput,
} from '../../../schemas/contact.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const batchArchiveOutputSchema = z.object({
  success: z.boolean(),
  archivedCount: z.number(),
  contactIds: z.array(z.string()),
  message: z.string(),
});

interface BatchArchiveResult {
  readonly success: boolean;
  readonly archivedCount: number;
  readonly contactIds: readonly string[];
  readonly message: string;
}

/**
 * `hubspot_batch_archive_contacts` — archives up to 100 contacts per call.
 *
 * Bulk destruction is the highest-blast-radius operation an agent can reach,
 * so it carries the same literal-true confirmation gate as the single-record
 * destructive tools. Archiving remains reversible for 90 days via the UI,
 * which is why this is gated rather than withheld.
 *
 * HubSpot returns 204 with no body, so success is reported from the requested
 * ID list rather than invented from a response payload.
 *
 * @example
 * ```json
 * { "contactIds": ["51234567890", "51234567891"], "confirmArchive": true }
 * ```
 */
export class BatchArchiveContactsTool
  implements ToolDefinition<typeof batchArchiveContactsInputSchema, BatchArchiveResult>
{
  readonly name = 'hubspot_batch_archive_contacts';
  readonly title = 'Batch Archive HubSpot Contacts';
  readonly description =
    'Archive (soft-delete) up to 100 HubSpot contacts in a single request. Archived contacts ' +
    'leave the active CRM but stay recoverable from the HubSpot recycle bin for 90 days. ' +
    'Requires confirmArchive to be exactly true because this affects many records at once. ' +
    'Always confirm the exact list of contact IDs with the user before calling this.';

  readonly inputSchema = batchArchiveContactsInputSchema;
  readonly outputSchema = batchArchiveOutputSchema;

  readonly annotations = {
    title: 'Batch Archive HubSpot Contacts',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(
    input: BatchArchiveContactsInput,
    context: ToolExecutionContext
  ): Promise<BatchArchiveResult> {
    context.logger.warn(
      { count: input.contactIds.length, contactIds: input.contactIds },
      'Batch archiving HubSpot contacts.'
    );

    const archivedCount = await this.contacts.batchArchive(input.contactIds);

    return {
      success: true,
      archivedCount,
      contactIds: input.contactIds,
      message:
        `${archivedCount} contact(s) archived. They can be restored from the HubSpot recycle ` +
        'bin within 90 days.',
    };
  }
}
