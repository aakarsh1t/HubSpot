import type { ContactsService } from '../../../services/contacts.service.js';
import {
  contactOutputSchema,
  updateContactInputSchema,
  type UpdateContactInput,
} from '../../../schemas/contact.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

/**
 * `hubspot_update_contact` — updates properties on an existing contact.
 *
 * PATCH semantics: only the supplied properties change, everything else is
 * left alone. Passing `null` clears a property. Because the record is
 * addressed by ID, the operation is idempotent and safe to retry.
 *
 * @example Update lifecycle stage
 * ```json
 * { "contactId": "51234567890", "properties": { "lifecyclestage": "customer" } }
 * ```
 *
 * @example Clear a property
 * ```json
 * { "contactId": "51234567890", "properties": { "jobtitle": null } }
 * ```
 */
export class UpdateContactTool implements ToolDefinition<
  typeof updateContactInputSchema,
  CrmObject
> {
  readonly name = 'hubspot_update_contact';
  readonly title = 'Update HubSpot Contact';
  readonly description =
    'Update one or more properties on an existing HubSpot contact, identified by its record ID. ' +
    'Only the properties you supply are changed; all others are left untouched. Pass null as a ' +
    'value to clear a property. Use hubspot_get_contact_by_email first if you know the email ' +
    'but not the contact ID. Returns the updated contact.';

  readonly inputSchema = updateContactInputSchema;
  readonly outputSchema = contactOutputSchema;

  readonly annotations = {
    title: 'Update HubSpot Contact',
    readOnlyHint: false,
    destructiveHint: false,
    // Same PATCH applied twice yields the same final state.
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly contacts: ContactsService;

  constructor(contacts: ContactsService) {
    this.contacts = contacts;
  }

  async execute(input: UpdateContactInput, context: ToolExecutionContext): Promise<CrmObject> {
    context.logger.debug(
      { contactId: input.contactId, properties: Object.keys(input.properties) },
      'Updating HubSpot contact.'
    );

    return this.contacts.update(input);
  }
}
