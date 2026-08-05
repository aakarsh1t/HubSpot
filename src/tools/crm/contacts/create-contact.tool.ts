import type { ContactsService } from '../../../services/contacts.service.js';
import {
  contactOutputSchema,
  createContactInputSchema,
  type CreateContactInput,
} from '../../../schemas/contact.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_create_contact` — creates a single contact.
 *
 * Not idempotent: the underlying request is marked non-retryable so a
 * transient failure can never produce a duplicate record. HubSpot enforces
 * email uniqueness itself and returns 409 for a duplicate, which surfaces here
 * as a validation error naming the conflict.
 *
 * @example Minimal
 * ```json
 * { "properties": { "email": "jane.doe@acme.com" } }
 * ```
 *
 * @example With associations
 * ```json
 * {
 *   "properties": {
 *     "email": "jane.doe@acme.com",
 *     "firstname": "Jane",
 *     "lastname": "Doe",
 *     "jobtitle": "CTO",
 *     "lifecyclestage": "lead"
 *   },
 *   "associations": [{ "toObjectType": "companies", "toObjectId": "7801" }]
 * }
 * ```
 */
export class CreateContactTool
  implements ToolDefinition<typeof createContactInputSchema, CrmObject>
{
  readonly name = 'hubspot_create_contact';
  readonly title = 'Create HubSpot Contact';
  readonly description =
    'Create a new contact in HubSpot. Supply contact fields as a properties object using ' +
    'HubSpot internal property names (email, firstname, lastname, phone, company, jobtitle, ' +
    'lifecyclestage, and any custom properties). Optionally associate the new contact with ' +
    'existing companies, deals, or tickets. Email should be provided whenever known, because ' +
    'HubSpot uses it to deduplicate contacts. Returns the created contact including its new ID. ' +
    'Use hubspot_update_contact instead if the contact already exists.';

  readonly inputSchema = createContactInputSchema;
  readonly outputSchema = contactOutputSchema;

  readonly annotations = {
    title: 'Create HubSpot Contact',
    readOnlyHint: false,
    destructiveHint: false,
    // Calling twice creates two contacts (or fails on the email conflict).
    idempotentHint: false,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(input: CreateContactInput, context: ToolExecutionContext): Promise<CrmObject> {
    context.logger.debug(
      { propertyCount: Object.keys(input.properties).length },
      'Creating HubSpot contact.'
    );

    return this.contacts.create(input);
  }
}
