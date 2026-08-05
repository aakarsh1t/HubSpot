import type { ContactsService } from '../../../services/contacts.service.js';
import {
  batchOutcomeOutputSchema,
  batchUpdateContactsInputSchema,
  type BatchUpdateContactsInput,
} from '../../../schemas/contact.schema.js';
import type { BatchOutcome, CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_batch_update_contacts` — updates up to 100 contacts per call.
 *
 * Each entry is addressed by record ID and applies PATCH semantics, so the
 * whole batch is idempotent and safe to retry — unlike batch create.
 *
 * @example
 * ```json
 * {
 *   "contacts": [
 *     { "contactId": "51234567890", "properties": { "lifecyclestage": "customer" } },
 *     { "contactId": "51234567891", "properties": { "hs_lead_status": "OPEN" } }
 *   ]
 * }
 * ```
 */
export class BatchUpdateContactsTool implements ToolDefinition<
  typeof batchUpdateContactsInputSchema,
  BatchOutcome<CrmObject>
> {
  readonly name = 'hubspot_batch_update_contacts';
  readonly title = 'Batch Update HubSpot Contacts';
  readonly description =
    'Update up to 100 existing HubSpot contacts in a single request. Each entry needs a contact ' +
    'ID and the properties to change; unlisted properties are left untouched. Individual records ' +
    'can fail while others succeed, so check the returned status, succeeded/failed counts, and ' +
    'errors array. Records that do not exist will fail.';

  readonly inputSchema = batchUpdateContactsInputSchema;
  readonly outputSchema = batchOutcomeOutputSchema;

  readonly annotations = {
    title: 'Batch Update HubSpot Contacts',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(
    input: BatchUpdateContactsInput,
    context: ToolExecutionContext
  ): Promise<BatchOutcome<CrmObject>> {
    context.logger.info({ count: input.contacts.length }, 'Batch updating HubSpot contacts.');

    const outcome = await this.contacts.batchUpdate(input);

    if (outcome.failed > 0) {
      context.logger.warn(
        { requested: outcome.requested, succeeded: outcome.succeeded, failed: outcome.failed },
        'Batch contact update completed with failures.'
      );
    }

    return outcome;
  }
}
