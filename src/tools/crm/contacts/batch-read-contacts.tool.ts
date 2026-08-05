import type { ContactsService } from '../../../services/contacts.service.js';
import {
  batchOutcomeOutputSchema,
  batchReadContactsInputSchema,
  type BatchReadContactsInput,
} from '../../../schemas/contact.schema.js';
import type { BatchOutcome, CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_batch_read_contacts` — reads up to 100 contacts in one call.
 *
 * The companion to the batch write tools, and the fix for the most common
 * agent anti-pattern: looping a single-record read over a list of IDs, which
 * turns one request into a hundred and exhausts the HubSpot rate limit.
 *
 * Accepts either record IDs or email addresses via `idProperty`.
 *
 * @example By ID
 * ```json
 * { "contactIds": ["51234567890", "51234567891"] }
 * ```
 *
 * @example By email
 * ```json
 * { "contactIds": ["a@acme.com", "b@acme.com"], "idProperty": "email" }
 * ```
 */
export class BatchReadContactsTool implements ToolDefinition<
  typeof batchReadContactsInputSchema,
  BatchOutcome<CrmObject>
> {
  readonly name = 'hubspot_batch_read_contacts';
  readonly title = 'Batch Read HubSpot Contacts';
  readonly description =
    'Retrieve up to 100 HubSpot contacts in a single request, by record ID or by email address ' +
    '(set idProperty to "email"). Always prefer this over calling hubspot_get_contact repeatedly ' +
    'when you need several contacts — it is one API call instead of many. IDs that do not exist ' +
    'are reported in the errors array rather than failing the whole request.';

  readonly inputSchema = batchReadContactsInputSchema;
  readonly outputSchema = batchOutcomeOutputSchema;

  readonly annotations = {
    title: 'Batch Read HubSpot Contacts',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(
    input: BatchReadContactsInput,
    context: ToolExecutionContext
  ): Promise<BatchOutcome<CrmObject>> {
    context.logger.debug(
      { count: input.contactIds.length, idProperty: input.idProperty },
      'Batch reading HubSpot contacts.'
    );

    return this.contacts.batchRead(input);
  }
}
