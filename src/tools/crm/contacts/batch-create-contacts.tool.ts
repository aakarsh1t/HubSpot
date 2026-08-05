import type { ContactsService } from '../../../services/contacts.service.js';
import {
  batchCreateContactsInputSchema,
  batchOutcomeOutputSchema,
  type BatchCreateContactsInput,
} from '../../../schemas/contact.schema.js';
import type { BatchOutcome, CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_batch_create_contacts` — creates up to 100 contacts per call.
 *
 * The important detail is partial failure. HubSpot answers a mixed batch with
 * HTTP 207 and a body holding both results and errors; a caller that only
 * checks the status code will record a successful import while silently losing
 * records. The response here always states `requested`, `succeeded`, `failed`,
 * and a `status` of COMPLETE / PARTIAL / ERROR so that outcome is impossible
 * to miss.
 *
 * @example
 * ```json
 * {
 *   "contacts": [
 *     { "properties": { "email": "a@acme.com", "firstname": "Ann" } },
 *     { "properties": { "email": "b@acme.com", "firstname": "Ben" } }
 *   ]
 * }
 * ```
 */
export class BatchCreateContactsTool implements ToolDefinition<
  typeof batchCreateContactsInputSchema,
  BatchOutcome<CrmObject>
> {
  readonly name = 'hubspot_batch_create_contacts';
  readonly title = 'Batch Create HubSpot Contacts';
  readonly description =
    'Create up to 100 HubSpot contacts in a single request — far more efficient than repeated ' +
    'single creates. Individual records can fail while others succeed, so always check the ' +
    'returned status (COMPLETE, PARTIAL, or ERROR) together with the succeeded and failed ' +
    'counts and the errors array. Contacts with an email that already exists in HubSpot will ' +
    'fail as duplicates.';

  readonly inputSchema = batchCreateContactsInputSchema;
  readonly outputSchema = batchOutcomeOutputSchema;

  readonly annotations = {
    title: 'Batch Create HubSpot Contacts',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(
    input: BatchCreateContactsInput,
    context: ToolExecutionContext
  ): Promise<BatchOutcome<CrmObject>> {
    context.logger.info({ count: input.contacts.length }, 'Batch creating HubSpot contacts.');

    const outcome = await this.contacts.batchCreate(input);

    if (outcome.failed > 0) {
      context.logger.warn(
        { requested: outcome.requested, succeeded: outcome.succeeded, failed: outcome.failed },
        'Batch contact creation completed with failures.'
      );
    }

    return outcome;
  }
}
