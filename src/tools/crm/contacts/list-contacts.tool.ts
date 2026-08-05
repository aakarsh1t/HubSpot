import type { ContactsService } from '../../../services/contacts.service.js';
import {
  contactPageOutputSchema,
  listContactsInputSchema,
  type ListContactsInput,
} from '../../../schemas/contact.schema.js';
import type { CrmObject } from '../../../types/crm.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../types/tool.types.js';

interface ContactPageResult {
  readonly results: readonly CrmObject[];
  readonly after: string | null;
  readonly total: number | null;
  readonly count: number;
}

/**
 * `hubspot_list_contacts` — pages through contacts without search criteria.
 *
 * Kept distinct from `hubspot_search_contacts` because the two hit different
 * HubSpot subsystems with different rate limits. Listing is the right tool for
 * "show me some contacts" or a full export walk; searching is for "find
 * contacts where X".
 *
 * @example First page
 * ```json
 * { "limit": 25 }
 * ```
 *
 * @example Next page
 * ```json
 * { "limit": 25, "after": "51234567890" }
 * ```
 */
export class ListContactsTool
  implements ToolDefinition<typeof listContactsInputSchema, ContactPageResult>
{
  readonly name = 'hubspot_list_contacts';
  readonly title = 'List HubSpot Contacts';
  readonly description =
    'List HubSpot contacts page by page, without any search criteria. Returns up to 100 per ' +
    'call along with an "after" cursor; pass that cursor back to fetch the next page, and stop ' +
    'when it is null. Use hubspot_search_contacts instead when you need to filter by property ' +
    'values, and hubspot_get_contact_by_email for a single known person. Set archived to true ' +
    'to list deleted contacts.';

  readonly inputSchema = listContactsInputSchema;
  readonly outputSchema = contactPageOutputSchema;

  readonly annotations = {
    title: 'List HubSpot Contacts',
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
    input: ListContactsInput,
    context: ToolExecutionContext
  ): Promise<ContactPageResult> {
    context.logger.debug({ limit: input.limit, archived: input.archived }, 'Listing HubSpot contacts.');

    const page = await this.contacts.list(input);

    return { ...page, count: page.results.length };
  }
}
