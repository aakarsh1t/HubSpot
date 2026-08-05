import { z } from 'zod';
import type { ContactsService } from '../../../services/contacts.service.js';
import {
  contactOutputSchema,
  getContactInputSchema,
  type GetContactInput,
} from '../../../schemas/contact.schema.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

const getContactOutputSchema = contactOutputSchema.extend({
  associations: z
    .record(z.string(), z.array(z.string()))
    .describe('Associated record IDs keyed by object type, when requested.'),
});

interface GetContactResult {
  readonly id: string;
  readonly properties: Record<string, string | null>;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly archived: boolean;
  readonly associations: Record<string, string[]>;
}

/**
 * `hubspot_get_contact` — reads one contact by record ID.
 *
 * Can also read archived records within their 90-day window, which is what
 * makes it useful for confirming an accidental deletion before attempting
 * recovery.
 *
 * @example Basic read
 * ```json
 * { "contactId": "51234567890" }
 * ```
 *
 * @example With specific properties and associations
 * ```json
 * {
 *   "contactId": "51234567890",
 *   "properties": ["email", "firstname", "lastname", "hs_lead_status"],
 *   "includeAssociations": ["companies", "deals"]
 * }
 * ```
 *
 * @example Inspect an archived contact
 * ```json
 * { "contactId": "51234567890", "archived": true }
 * ```
 */
export class GetContactTool implements ToolDefinition<
  typeof getContactInputSchema,
  GetContactResult
> {
  readonly name = 'hubspot_get_contact';
  readonly title = 'Get HubSpot Contact by ID';
  readonly description =
    'Retrieve a single HubSpot contact by its numeric record ID. Optionally request specific ' +
    'properties and the IDs of associated companies, deals, tickets, or activities. Set archived ' +
    'to true to read a contact that has been deleted (readable for 90 days after archiving). ' +
    'If you only know the email address, use hubspot_get_contact_by_email instead.';

  readonly inputSchema = getContactInputSchema;
  readonly outputSchema = getContactOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Contact by ID',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(input: GetContactInput, context: ToolExecutionContext): Promise<GetContactResult> {
    context.logger.debug(
      { contactId: input.contactId, archived: input.archived },
      'Reading HubSpot contact.'
    );

    return this.contacts.getById({
      contactId: input.contactId,
      properties: input.properties,
      associations: input.includeAssociations,
      archived: input.archived,
    });
  }
}
