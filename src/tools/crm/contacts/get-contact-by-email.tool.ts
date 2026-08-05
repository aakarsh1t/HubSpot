import type { ContactsService } from '../../../services/contacts.service.js';
import {
  contactOutputSchema,
  getContactByEmailInputSchema,
  type GetContactByEmailInput,
} from '../../../schemas/contact.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_get_contact_by_email` — reads one contact by email address.
 *
 * Implemented with HubSpot's alternate-key lookup (`idProperty=email`) rather
 * than a search request. That distinction matters in production: it is a
 * single indexed read instead of a query, so it is faster, returns exactly one
 * record, and is not charged against the CRM search API's separate and much
 * tighter rate limit.
 *
 * @example
 * ```json
 * { "email": "jane.doe@acme.com" }
 * ```
 *
 * @example Selected properties only
 * ```json
 * { "email": "jane.doe@acme.com", "properties": ["email", "firstname", "lifecyclestage"] }
 * ```
 */
export class GetContactByEmailTool
  implements ToolDefinition<typeof getContactByEmailInputSchema, CrmObject>
{
  readonly name = 'hubspot_get_contact_by_email';
  readonly title = 'Get HubSpot Contact by Email';
  readonly description =
    'Retrieve a HubSpot contact by email address. This is the fastest way to find a specific ' +
    'person when you know their email, and is preferred over hubspot_search_contacts for an ' +
    'exact email lookup. Returns a clear not-found error if no contact has that address. Use ' +
    'the returned contact ID for any follow-up update, association, or activity-logging call.';

  readonly inputSchema = getContactByEmailInputSchema;
  readonly outputSchema = contactOutputSchema;

  readonly annotations = {
    title: 'Get HubSpot Contact by Email',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(input: GetContactByEmailInput, context: ToolExecutionContext): Promise<CrmObject> {
    context.logger.debug('Looking up HubSpot contact by email.');

    return this.contacts.getByEmail({
      email: input.email,
      properties: input.properties,
    });
  }
}
